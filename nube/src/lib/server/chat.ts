import { and, desc, eq, lt } from 'drizzle-orm';
import { describeRecipe, parseRecipe } from 'comun/recipe.ts';
import {
	CHAT_HISTORY,
	firstRead,
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
import { isRead, READ_TOOLS, runRead } from '#lib/server/chat-reads.ts';
import { describeBlock, spendingBars } from '#lib/server/blocks.ts';
import { openPage, PAGES } from '#lib/chat-pages.ts';
import { MAX_PIECES, REPORT_BLOCKS, REPORT_DAYS } from '#lib/reports.ts';
import { describePiece, makeReport } from '#lib/server/reports.ts';
import { euros } from 'comun/expenses.ts';
import { localDay } from 'comun/agenda.ts';
import { FALLBACK_VOICE_MODEL, voiceSettings } from '#lib/server/voice/settings.ts';

/**
 * «Preguntar» (#470): each adult's chat with the family's AI, with their history. The same AI as
 * the voice, but where there is a screen: instead of doing things, it proposes them as cards (things
 * to buy, each with its check; a recipe to save or cook), and the person taps what they want. Only
 * theirs (every query by their user id); children have no chat (kids.ts lets them nowhere near).
 */

/**
 * Rounds of tools at most: then what it said and the cards it made are the answer. Crossing
 * sections (#504) takes a few reads before the cards.
 */
const MAX_ROUNDS = 6;
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
	),
	fn(
		'open_page',
		`Abre una página de Seilide ya filtrada, para enseñar lo que hablas: al lado del chat, en grande, la propia sección. Úsala cuando la respuesta se ve mejor en su página («enséñame los gastos de octubre», «¿qué tenemos esta semana?»), no para todo. Páginas: ${Object.entries(
			PAGES
		)
			.map(([name, what]) => `«${name}»: ${what}`)
			.join('; ')}.`,
		{
			page: { type: 'string', enum: Object.keys(PAGES) },
			month: { type: 'string', description: 'gastos_mes, ingresos_mes: el mes, AAAA-MM.' },
			months: { type: 'integer', description: 'analisis: 3, 6 o 12 meses.' },
			without_fixed: { type: 'boolean', description: 'analisis: sin los gastos fijos.' },
			words: { type: 'string', description: 'busqueda, notas: qué buscar.' },
			from_day: { type: 'string', description: 'busqueda: desde qué día, AAAA-MM-DD.' },
			to_day: { type: 'string', description: 'busqueda: hasta qué día, AAAA-MM-DD.' },
			kind: { type: 'string', description: 'facturas: «Luz», «Agua» o «Gas».' },
			day: { type: 'string', description: 'agenda: un día de la semana o del mes, AAAA-MM-DD.' },
			month_view: { type: 'boolean', description: 'agenda: el mes entero en vez de la semana.' }
		},
		['page']
	),
	fn(
		'show_spending_chart',
		'Una gráfica de barras de lo gastado mes a mes, cada categoría en su color, hecha por Seilide con sus cifras: para comparar meses o ver en qué se va el dinero. Va en el chat; no repitas sus cifras una a una en el texto, comenta lo que se ve.',
		{
			from_month: { type: 'string', description: 'El primer mes, AAAA-MM.' },
			to_month: { type: 'string', description: 'El último mes, AAAA-MM; como mucho, 24 meses.' },
			title: { type: 'string', description: 'El título, corto: «Gastos de este año».' }
		},
		['from_month', 'to_month']
	),
	fn(
		'make_report',
		`Hace un informe y lo guarda en Preguntar → Informes, donde se vuelve a abrir: un documento de unos días (un viaje, unas vacaciones, un mes) con bloques que Seilide llena con sus datos. Tú eliges los bloques, en orden, y escribes un texto corto antes de cada uno; las cifras las pone Seilide, no las escribas. Solo cuando lo pide («hazme un informe», «guárdamelo»), y con los días ya confirmados. Bloques: ${Object.entries(
			REPORT_BLOCKS
		)
			.map(([name, what]) => `«${name}»: ${what}`)
			.join('; ')}. Para un viaje: cifras, mapa, tiempo, fotos, gastos y agenda.`,
		{
			title: { type: 'string', description: 'El título, corto: «Alicante, julio de 2026».' },
			from_day: { type: 'string', description: 'El primer día, AAAA-MM-DD.' },
			to_day: {
				type: 'string',
				description: `El último día, AAAA-MM-DD; como mucho ${REPORT_DAYS} días.`
			},
			pieces: {
				type: 'array',
				description: `Las partes, en orden, hasta ${MAX_PIECES}.`,
				items: {
					type: 'object',
					properties: {
						text: {
							type: 'string',
							description: 'Lo que va antes del bloque: una o dos frases, sin cifras. Vacío, nada.'
						},
						block: { type: 'string', enum: Object.keys(REPORT_BLOCKS) }
					},
					required: ['text', 'block'],
					additionalProperties: false
				}
			}
		},
		['title', 'from_day', 'to_day', 'pieces']
	)
];

function system(context: {
	name: string;
	style: string | null;
	/** The section they are looking at, with the chat beside it (#504); none from Preguntar itself. */
	section?: string | null;
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
- Es un chat en el móvil o en un panel estrecho al lado de la app: párrafos cortos. Sin títulos, negritas ni tablas (no se ven). Para enumerar, líneas que empiecen por «- ».
- Lo que se puede hacer con un toque va en tarjetas, no en el texto:
  - Si hace falta comprar algo (ingredientes, utensilios para empezar), propónlo con «propose_shopping», en una sola tarjeta, y no repitas la lista en el texto. No propongas lo que ya está en la lista de la compra (abajo) ni lo que la persona ha dicho que tiene; si alguna de esas hace falta, dilo en una frase.
  - Una receta para hacer, con «propose_recipe», entera; no la escribas también en el texto. Ajústala a lo que ha dicho (su molde, su horno, cuántos son). Si está en el recetario (abajo), léela con «read_recipe» antes de hablar de ella.
- Para enseñar algo que se ve mejor que con palabras: una gráfica de gastos («show_spending_chart») o la propia página de la sección ya filtrada («open_page»), que se abre en grande al lado del chat. Solo cuando ayuda; no las dos para lo mismo.
- Los datos de la familia (agenda, gastos, notas, lo que recuerda la voz, reglas, viajes) no vienen en este mensaje: léelos con sus herramientas antes de contestar, y cruza varias si la pregunta lo pide. Las cifras y las fechas, solo las que te den las herramientas; si no hay datos, dilo. Di de qué días o meses hablas.
- Si pregunta por un viaje o unos días que no dice con fecha («mis viajes a Alicante», «las vacaciones»), búscalos primero con «find_trips» y pregunta si son esos, con sus fechas, antes de leer nada más ni sacar cifras. Confirmados, lee sus días con «read_period».
- Para el tiempo de unos días, o para explicar un gasto por el frío o el calor (la luz, el gas, un enchufe), usa «read_weather»: compara con sus grados-día (los del mismo periodo de otro año, si los hay), no con tu idea del clima.
- El texto acompaña a las tarjetas: por qué esas cosas, un consejo, qué viene después. Breve.
- Lo que conviene «para más adelante» (no ahora), en el texto, en pocas líneas: no en la tarjeta de compra.
- Nada se guarda sin que la persona lo toque, salvo los informes que pide («make_report» los guarda): no digas que has añadido o guardado nada más. Si después aparece en lo hablado que lo añadió o guardó, ya está hecho.
${context.style ? `- El carácter de la casa, solo el tono: «${context.style}».\n` : ''}
Ahora es ${today} (${localDay()}).
${context.section ? `\nEscribe desde el panel de Preguntar abierto al lado de la sección «${context.section}» de Seilide, que está mirando: si la pregunta no dice de qué habla, seguramente va de eso. Si es de una sección que tus herramientas no leen, dilo en una frase, sin inventar sus datos.\n` : ''}

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
	if (card.kind === 'pagina') return `[Página abierta: ${card.label}]`;
	if (card.kind === 'bloque') return `[Gráfica enseñada: ${describeBlock(card.block, euros)}]`;
	if (card.kind === 'informe')
		return `[Informe guardado en Informes: «${card.title}», del ${card.from} al ${card.to}]`;
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
async function runTool(
	k: Kitchen,
	userId: string,
	call: ToolCall
): Promise<{ result: string; card?: ChatCard }> {
	const args = parseArgs(call);
	// The sections' reads (#504): what the person may see of them.
	if (isRead(call.function.name))
		return { result: await runRead(k, userId, call.function.name, args) };
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
		case 'open_page': {
			const { page, ...filters } = args;
			const opened = openPage(page, filters);
			if (typeof opened === 'string') return { result: opened };
			return {
				result: `Abierta «${opened.label}»: la persona la ve en grande. No describas la página entera; di lo importante.`,
				card: { kind: 'pagina', ...opened }
			};
		}
		case 'show_spending_chart': {
			const block = await spendingBars(k, args.from_month, args.to_month, args.title);
			if (typeof block === 'string') return { result: block };
			return {
				result: `Gráfica enseñada. Lo que muestra:\n${describeBlock(block, euros)}`,
				card: { kind: 'bloque', block }
			};
		}
		case 'make_report': {
			const made = await makeReport(k, userId, args);
			if (typeof made === 'string') return { result: made };
			const shown = made.pieces
				.map((p) => describePiece(p))
				.filter(Boolean)
				.join('\n');
			return {
				result: `Informe «${made.title}» guardado en Informes; la persona lo abre desde la tarjeta. Lleva:\n${shown}\nEn el chat, una o dos frases: no repitas el informe.`,
				card: { kind: 'informe', id: made.id, title: made.title, from: made.from, to: made.to }
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
	question: string,
	/** The section's name, when asked from the panel beside it (#504). */
	section: string | null = null
): Promise<ChatMessage[]> {
	const said = question.trim().slice(0, MAX_CHAT_QUESTION);
	if (!said) throw new ChatError('Escribe algo');
	const [apiKey, settings, history, buying, recipes] = await Promise.all([
		openRouterKey(k),
		voiceSettings(k),
		chatHistory(k, who.id, CHAT_HISTORY),
		toBuy(k),
		listRecipes(k)
	]);
	if (!apiKey)
		throw new ChatError('La familia no tiene clave de IA: quien administra la pone en Ajustes');

	const messages: ToolChatMessage[] = [
		{
			role: 'system',
			content: system({ name: who.name, style: settings.style, section, toBuy: buying, recipes })
		},
		...history
			.slice(firstRead(history))
			.map((m): ToolChatMessage => ({ role: m.role, content: asText(m) || '(sin texto)' })),
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
				tools: [...TOOLS, ...READ_TOOLS],
				timeoutMs: TIMEOUT_MS
			});
			if (answer.content) text = answer.content.trim();
			if (!answer.toolCalls.length) break;
			messages.push({ role: 'assistant', content: answer.content, tool_calls: answer.toolCalls });
			for (const call of answer.toolCalls) {
				const { result, card } = await runTool(k, who.id, call);
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

/**
 * Days a chat's message is kept: what is worth keeping already lives elsewhere (the list, the
 * recipes, the reports, «recuerda»), and the AI reads only the last CHAT_HISTORY.
 */
export const CHAT_DAYS = 30;

/** Each night (scheduler.ts): the family's messages older than CHAT_DAYS, gone. How many. */
export async function forgetOldChat(k: Kitchen, now = new Date()) {
	const before = new Date(now.getTime() - CHAT_DAYS * 86_400_000);
	const gone = await k.run((tx) =>
		tx
			.delete(chatMessage)
			.where(and(eq(chatMessage.familyId, k.familyId), lt(chatMessage.createdAt, before)))
			.returning({ id: chatMessage.id })
	);
	return gone.length;
}

/** «Empezar de nuevo»: their whole chat, gone. */
export async function clearChat(k: Kitchen, userId: string) {
	await k.run((tx) => tx.delete(chatMessage).where(eq(chatMessage.userId, userId)));
}
