import { and, desc, eq } from 'drizzle-orm';
import { describeRecipe, parseRecipe } from 'comun/recipe.ts';
import {
	MAX_CARD_ITEMS,
	MAX_CHAT_QUESTION,
	type ChatCard,
	type ChatMessage,
	type ShoppingCard
} from '#lib/chat.ts';
import { chatMessage } from '#lib/server/db/schema.ts';
import { openRouterKey } from '#lib/server/family-settings.ts';
import { addItems, toBuy, type Kitchen } from '#lib/server/fridge.ts';
import {
	chatWithTools,
	sayableError,
	type Tool,
	type ToolCall,
	type ToolChatMessage
} from '#lib/server/openrouter.ts';
import { getRecipe, listRecipes, saveWrittenRecipe } from '#lib/server/recipes/import.ts';
import { FALLBACK_VOICE_MODEL, voiceSettings } from '#lib/server/voice/settings.ts';

/**
 * «Preguntar» (#470): each adult's chat with the family's AI, with their history. The same AI as
 * the voice, but where there is a screen: instead of doing things, it proposes them as cards (things
 * to buy, each with its check; a recipe to save or cook), and the person taps what they want. Only
 * theirs (every query by their user id); children have no chat (kids.ts lets them nowhere near).
 */

/** The messages sent with each question: enough to follow the thread, not a whole month. */
const HISTORY = 20;
/** Rounds of tools at most: then what it said and the cards it made are the answer. */
const MAX_ROUNDS = 4;
/** What the page shows, the latest. */
const SHOWN = 200;
/** A thinking model writing a whole recipe: the person is waiting, but reading, not listening. */
const TIMEOUT_MS = 60_000;

const TIME_ZONE = process.env.TZ || 'Europe/Madrid';

const fn = (
	name: string,
	description: string,
	properties: Record<string, unknown>,
	required: string[]
): Tool => ({
	type: 'function',
	function: {
		name,
		description,
		parameters: { type: 'object', properties, required, additionalProperties: false }
	}
});

const TOOLS: Tool[] = [
	fn(
		'propose_shopping',
		'Enseña una tarjeta con cosas para comprar, cada una con su casilla: la persona marca las que quiere y las añade a la lista de la compra de la familia con un toque. No añade nada por sí sola.',
		{
			items: {
				type: 'array',
				items: { type: 'string' },
				maxItems: MAX_CARD_ITEMS,
				description:
					'Cada cosa como se apunta en una lista, con la cantidad si importa: «Harina de trigo (1 kg)», «Huevos (media docena)», «Papel de horno».'
			}
		},
		['items']
	),
	fn(
		'propose_recipe',
		'Enseña una receta entera en una tarjeta, con «Guardar en Recetas» y «Cocinar ahora» (el modo cocina, paso a paso y con sus temporizadores). No guarda nada por sí sola.',
		{
			title: { type: 'string', description: 'El plato: «Bizcocho de yogur».' },
			servings: { type: 'integer', description: 'Para cuántas personas.' },
			ingredients: {
				type: 'array',
				items: { type: 'string' },
				description: 'Cada uno con su cantidad: «3 huevos», «2 vasitos de yogur de azúcar».'
			},
			steps: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						text: {
							type: 'string',
							description:
								'Una o dos frases cortas, que se puedan oír en el modo cocina: «Bate los huevos con el azúcar hasta que blanqueen».'
						},
						timer_minutes: {
							type: 'number',
							description: 'Si el paso es esperar un tiempo: cuántos minutos.'
						},
						timer_label: {
							type: 'string',
							description: 'El nombre de ese temporizador, corto: «el bizcocho», «el horno».'
						},
						timer_trigger: {
							type: 'string',
							description:
								'Si el tiempo empieza con algo que pasará luego, para completar «arranca cuando…»: «metas el molde». Vacío si empieza con el paso.'
						}
					},
					required: ['text'],
					additionalProperties: false
				}
			}
		},
		['title', 'ingredients', 'steps']
	),
	fn(
		'read_recipe',
		'Lee entera una receta del recetario de la familia (ingredientes y pasos), para contestar sobre ella o adaptarla.',
		{ id: { type: 'integer', description: 'Su número en el recetario.' } },
		['id']
	)
];

function system(context: {
	name: string;
	style: string | null;
	toBuy: string[];
	recipes: { id: number; title: string }[];
}) {
	const today = new Intl.DateTimeFormat('es-ES', {
		dateStyle: 'full',
		timeStyle: 'short',
		timeZone: TIME_ZONE
	}).format();
	return `Eres el asistente de Seilide, la app de una familia, en su sección «Preguntar»: un chat por escrito con ${context.name}. Contesta en español de España, de tú, claro y sin rodeos.

Cómo escribir:
- Es un chat en el móvil: párrafos cortos. Sin títulos, negritas ni tablas (no se ven). Para enumerar, líneas que empiecen por «- ».
- Lo que se puede hacer con un toque va en tarjetas, no en el texto:
  - Si hace falta comprar algo (ingredientes, utensilios para empezar), propónlo con «propose_shopping», en una sola tarjeta, y no repitas la lista en el texto. No propongas lo que ya está en la lista de la compra (abajo) ni lo que la persona ha dicho que tiene; si alguna de esas hace falta, dilo en una frase.
  - Una receta para hacer, con «propose_recipe», entera; no la escribas también en el texto. Ajústala a lo que ha dicho (su molde, su horno, cuántos son). Si está en el recetario (abajo), léela con «read_recipe» antes de hablar de ella.
- El texto acompaña a las tarjetas: por qué esas cosas, un consejo, qué viene después. Breve.
- Lo que conviene «para más adelante» (no ahora), en el texto, en pocas líneas: no en la tarjeta de compra.
- Nada se guarda sin que la persona lo toque: no digas que has añadido o guardado nada. Si después aparece en lo hablado que lo añadió o guardó, ya está hecho.
${context.style ? `- El carácter de la casa, solo el tono: «${context.style}».\n` : ''}
Ahora es ${today}.

Lista de la compra de la familia, por comprar:
${context.toBuy.map((t) => `- ${t}`).join('\n') || '(vacía)'}

Recetario de la familia:
${context.recipes.map((r) => `- ${r.title} [receta ${r.id}]`).join('\n') || '(vacío)'}`;
}

/** A card as the AI is told of it later: what it proposed and what the person took. */
function cardLine(card: ChatCard) {
	if (card.kind === 'compra')
		return `[Tarjeta de compra: ${card.items.join('; ')}. ${
			card.added === null
				? 'No ha añadido nada aún.'
				: card.added.length
					? `Añadió a la lista: ${card.added.join('; ')}.`
					: 'No añadió nada.'
		}]`;
	return `[Tarjeta de receta${card.savedId ? `, guardada en el recetario (receta ${card.savedId})` : ', sin guardar'}:\n${describeRecipe(card.recipe, -1)}]`;
}

const asText = (m: Pick<ChatMessage, 'text' | 'cards'>) =>
	[m.text, ...m.cards.map(cardLine)].filter(Boolean).join('\n\n');

/** Their chat, the oldest first: the latest `SHOWN`. */
export async function chatHistory(
	k: Kitchen,
	userId: string,
	limit = SHOWN
): Promise<ChatMessage[]> {
	const rows = await k.run((tx) =>
		tx
			.select({
				id: chatMessage.id,
				role: chatMessage.role,
				text: chatMessage.text,
				cards: chatMessage.cards,
				createdAt: chatMessage.createdAt
			})
			.from(chatMessage)
			.where(eq(chatMessage.userId, userId))
			.orderBy(desc(chatMessage.id))
			.limit(limit)
	);
	return rows.reverse();
}

function parseArgs(call: ToolCall): Record<string, unknown> {
	try {
		const args = JSON.parse(call.function.arguments || '{}');
		return args && typeof args === 'object' ? args : {};
	} catch {
		return {};
	}
}

/** The items of a `propose_shopping`, trimmed and without repeats. */
export function shoppingItems(value: unknown): string[] {
	const seen = new Set<string>();
	return (Array.isArray(value) ? value : [])
		.flatMap((v) => (typeof v === 'string' && v.trim() ? [v.trim().slice(0, 100)] : []))
		.filter((t) => {
			const key = t.toLowerCase();
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.slice(0, MAX_CARD_ITEMS);
}

/** A tool run: its result for the AI, and the card it makes, if any. */
async function runTool(k: Kitchen, call: ToolCall): Promise<{ result: string; card?: ChatCard }> {
	const args = parseArgs(call);
	switch (call.function.name) {
		case 'propose_shopping': {
			const items = shoppingItems(args.items);
			if (!items.length) return { result: 'Sin cosas que comprar: no se enseña la tarjeta.' };
			return {
				result: `Tarjeta enseñada con ${items.length} cosas; la persona marca cuáles añade.`,
				card: { kind: 'compra', items, added: null }
			};
		}
		case 'propose_recipe': {
			const recipe = parseRecipe(args);
			if (typeof recipe === 'string') return { result: recipe };
			return {
				result: `Tarjeta de la receta «${recipe.title}» enseñada; la persona decide si la guarda o la cocina.`,
				card: { kind: 'receta', recipe, savedId: null }
			};
		}
		case 'read_recipe': {
			const saved = await getRecipe(k, Number(args.id));
			if (!saved) return { result: 'Esa receta no está en el recetario.' };
			const recipe = parseRecipe(saved);
			return {
				result:
					typeof recipe === 'string' ? `«${saved.title}»: ${recipe}` : describeRecipe(recipe, -1)
			};
		}
		default:
			return { result: `No hay ninguna herramienta «${call.function.name}».` };
	}
}

export class ChatError extends Error {}

/**
 * A question, answered: the AI with the family's key, with their history, the shopping list and the
 * recipe book; both messages saved together once it answered, so a failure leaves nothing behind
 * and the question can be asked again.
 */
export async function askChat(
	k: Kitchen,
	who: { id: string; name: string },
	question: string
): Promise<ChatMessage[]> {
	const said = question.trim().slice(0, MAX_CHAT_QUESTION);
	if (!said) throw new ChatError('Escribe algo');
	const [apiKey, settings, history, buying, recipes] = await Promise.all([
		openRouterKey(k),
		voiceSettings(k),
		chatHistory(k, who.id, HISTORY),
		toBuy(k),
		listRecipes(k)
	]);
	if (!apiKey)
		throw new ChatError('La familia no tiene clave de IA: quien administra la pone en Ajustes');

	const messages: ToolChatMessage[] = [
		{
			role: 'system',
			content: system({ name: who.name, style: settings.style, toBuy: buying, recipes })
		},
		...history.map((m): ToolChatMessage => ({ role: m.role, content: asText(m) || '(sin texto)' })),
		{ role: 'user', content: said }
	];
	const cards: ChatCard[] = [];
	let text = '';
	try {
		for (let round = 0; round < MAX_ROUNDS; round++) {
			const answer = await chatWithTools({
				apiKey,
				label: 'Preguntar',
				model: settings.conversationModel,
				fallbackModel: FALLBACK_VOICE_MODEL,
				messages,
				tools: TOOLS,
				timeoutMs: TIMEOUT_MS
			});
			if (answer.content) text = answer.content.trim();
			if (!answer.toolCalls.length) break;
			messages.push({ role: 'assistant', content: answer.content, tool_calls: answer.toolCalls });
			for (const call of answer.toolCalls) {
				const { result, card } = await runTool(k, call);
				if (card) cards.push(card);
				messages.push({ role: 'tool', tool_call_id: call.id, content: result });
			}
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[preguntar] ${message}`);
		throw new ChatError(sayableError(message));
	}
	if (!text && !cards.length) text = 'No sé qué contestar a eso. ¿Me lo dices de otra forma?';

	return k.run(async (tx) => {
		const rows = await tx
			.insert(chatMessage)
			.values([
				{ familyId: k.familyId, userId: who.id, role: 'user' as const, text: said },
				{ familyId: k.familyId, userId: who.id, role: 'assistant' as const, text, cards }
			])
			.returning();
		return rows.map((r) => ({
			id: r.id,
			role: r.role,
			text: r.text,
			cards: r.cards,
			createdAt: r.createdAt
		}));
	});
}

/** One of their answers' cards, to act on it; null if it is not theirs or not there. */
async function cardOf(k: Kitchen, userId: string, messageId: number, index: number) {
	const [row] = await k.run((tx) =>
		tx
			.select({ cards: chatMessage.cards })
			.from(chatMessage)
			.where(
				and(
					eq(chatMessage.id, messageId),
					eq(chatMessage.userId, userId),
					eq(chatMessage.role, 'assistant')
				)
			)
	);
	const card = row?.cards[index];
	return card ? { cards: row.cards, card } : null;
}

async function saveCards(k: Kitchen, userId: string, messageId: number, cards: ChatCard[]) {
	await k.run((tx) =>
		tx
			.update(chatMessage)
			.set({ cards })
			.where(and(eq(chatMessage.id, messageId), eq(chatMessage.userId, userId)))
	);
}

/**
 * The ticked items of a shopping card onto the family's list (fridge.ts: one already there stays as
 * it is). Only the card's own: nothing else can be slipped in. What went on, or null if no card.
 */
export async function addFromCard(
	k: Kitchen,
	userId: string,
	messageId: number,
	index: number,
	ticked: string[]
) {
	const found = await cardOf(k, userId, messageId, index);
	if (found?.card.kind !== 'compra') return null;
	const card: ShoppingCard = found.card;
	const chosen = card.items.filter((item) => ticked.includes(item));
	await addItems(k, chosen);
	const added = [...new Set([...(card.added ?? []), ...chosen])];
	found.cards[index] = { ...card, added };
	await saveCards(k, userId, messageId, found.cards);
	return chosen;
}

/** A recipe card into the family's recipe book: its number there, or null if no card. */
export async function saveRecipeFromCard(
	k: Kitchen,
	userId: string,
	messageId: number,
	index: number
) {
	const found = await cardOf(k, userId, messageId, index);
	if (found?.card.kind !== 'receta') return null;
	if (found.card.savedId && (await getRecipe(k, found.card.savedId))) return found.card.savedId;
	const id = await saveWrittenRecipe(k, found.card.recipe, `${messageId}/${index}`);
	found.cards[index] = { ...found.card, savedId: id };
	await saveCards(k, userId, messageId, found.cards);
	return id;
}

/** «Empezar de nuevo»: their whole chat, gone. */
export async function clearChat(k: Kitchen, userId: string) {
	await k.run((tx) => tx.delete(chatMessage).where(eq(chatMessage.userId, userId)));
}
