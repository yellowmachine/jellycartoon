import { dayName, localDay } from 'comun/agenda.ts';
import { openRouterKey } from '#lib/server/family-settings.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { familyHasHouse, sendHouse } from '#lib/server/house.ts';
import { keepInInbox } from '#lib/server/inbox-store.ts';
import { MAX_MEMORY } from '#lib/server/memory.ts';
import { completeJson } from '#lib/server/openrouter.ts';

/**
 * What a Telegram message has worth remembering (#331, phase 5): one of the chats a person chose
 * (the house's Ajustes → Telegram), passed by the house in their name. Read by the family's AI in
 * OpenRouter, or, if it fails, by the house's Ollama (its /api/v1/ia/json); almost always nothing.
 * When there is something («llegamos el sábado a las 11»), it is offered in their «Buzón», with
 * «Guardar» and «No»: kept, it goes to their own memory, never on its own.
 */

export interface TelegramSaid {
	/** The chat's name, as their Telegram has it. */
	chat: string;
	/** Who sent it; null, they themselves. */
	from: string | null;
	text: string;
}

interface Learned {
	merece: boolean;
	recuerdo: string;
	hasta: string | null;
}

const SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['merece', 'recuerdo', 'hasta'],
	properties: {
		merece: { type: 'boolean' },
		recuerdo: { type: 'string' },
		hasta: { type: ['string', 'null'] }
	}
};

const SYSTEM = (today: string, who: string) =>
	`Lees un mensaje de Telegram de ${who} y dices si tiene algo que merezca la pena recordar más adelante: un plan con fecha, una cita, un dato útil de la familia («llegamos el sábado a las 11», «el dentista es el martes a las 5», «la talla de Lucía ya es la 34»). Casi nunca: los saludos, las bromas, lo que solo vale ahora («ya voy»), las preguntas sin respuesta y la conversación, no. Hoy es ${dayName(today, true)} (${today}).
Si merece, «recuerdo» en una frase corta que se entienda sola, con nombres y fechas de verdad, sin «yo» ni «mañana» («Los padres de ${who} llegan el sábado 8 a las 11»), y «hasta» el último día que vale (AAAA-MM-DD), o null si vale siempre. Si no, «merece» false, «recuerdo» vacío y «hasta» null.`;

/** The AI's answer: OpenRouter's, else the house's Ollama's; null if neither answers. */
async function read(k: Kitchen, system: string, prompt: string): Promise<Learned | null> {
	const apiKey = await openRouterKey(k);
	if (apiKey)
		try {
			return await completeJson<Learned>({
				apiKey,
				label: 'Aprender de Telegram',
				system,
				prompt,
				name: 'learned',
				schema: SCHEMA,
				maxTokens: 300,
				timeoutMs: 20_000
			});
		} catch (error) {
			console.warn('[aprender] OpenRouter no contesta: al salón', { error: String(error) });
		}
	if (!(await familyHasHouse(k.familyId))) return null;
	try {
		const { answer } = await sendHouse<{ answer: Learned }>(
			k.familyId,
			'/ia/json',
			{ method: 'POST', body: JSON.stringify({ system, prompt, schema: SCHEMA }) },
			60_000
		);
		return answer;
	} catch (error) {
		console.warn('[aprender] El salón tampoco contesta', { error: String(error) });
		return null;
	}
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A message of theirs: if it has something worth remembering, offered in their «Buzón». */
export async function learnFromTelegram(
	k: Kitchen,
	userId: string,
	who: string,
	said: TelegramSaid
) {
	const today = localDay();
	const by = said.from ?? who;
	const prompt = `En «${said.chat}», ${by} escribe: «${said.text}»`;
	const learned = await read(k, SYSTEM(today, who), prompt);
	const text = learned?.merece ? learned.recuerdo.trim().slice(0, MAX_MEMORY) : '';
	if (!text) return null;
	const untilDay =
		learned!.hasta && DAY.test(learned!.hasta) && learned!.hasta >= today ? learned!.hasta : null;
	await keepInInbox(k, [userId], {
		kind: 'propuesta',
		title: '💡 ¿Lo recuerdo?',
		body: text,
		// The same, offered again while unanswered: in its place.
		tag: `propuesta-${text.toLowerCase().slice(0, 80)}`,
		url: '/buzon',
		ttl: 0,
		proposal: {
			text,
			untilDay,
			because: `de un mensaje de ${by} en «${said.chat}» en Telegram`
		}
	});
	console.info('[aprender] Propuesto', { userId, chat: said.chat });
	return text;
}
