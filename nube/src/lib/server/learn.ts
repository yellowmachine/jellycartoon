import { dayName, localDay } from 'comun/agenda.ts';
import { openRouterKey } from '#lib/server/family-settings.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { familyHasHouse, sendHouse } from '#lib/server/house.ts';
import { familyMember, user } from '#lib/server/db/schema.ts';
import { asFamily } from '#lib/server/family.ts';
import { keepInInbox, listInbox } from '#lib/server/inbox-store.ts';
import { heardOf } from '#lib/server/heard.ts';
import { listRules } from '#lib/server/rules.ts';
import { fridgeState, houseKitchen, kitchenOf } from '#lib/server/fridge.ts';
import { forget, learnedToday, listMemories, MAX_MEMORY, remember } from '#lib/server/memory.ts';
import { agendaBetween } from '#lib/server/agenda/agenda.ts';
import { pickLearned, sharesWords } from '#lib/server/voice/learned.ts';
import { eq, ne } from 'drizzle-orm';
import { completeJson } from '#lib/server/openrouter.ts';

/**
 * What a Telegram message has worth remembering (#331, phase 5): one of the chats a person chose
 * (the house's Ajustes → Telegram), passed by the house in their name. Read by the family's AI in
 * OpenRouter, or, if it fails, by the house's Ollama (its /api/v1/ia/json); almost always nothing.
 * When there is something («llegamos el sábado a las 11»), it is offered in their «Buzón», with
 * «Guardar» and «No»: kept, it goes to their own memory, never on its own.
 *
 * And what is said to the voice (phase 6): after each order, whether it told something worth
 * remembering, without «recuerda» («mañana no hay cole, es fiesta»): kept at once, marked as
 * learned from what was said (the voice says it with care), and each day at `SUMMARY_AT` the
 * day's in their «Buzón», each to take out with ×. Two ways, to see which works better.
 */

export interface TelegramSaid {
	/** The chat's name, as their Telegram has it. */
	chat: string;
	/** Who sent it; null, they themselves. */
	from: string | null;
	text: string;
}

/** An event worth having in the agenda, as the AI says it (phase 7); `titulo` empty, none. */
interface Event {
	titulo: string;
	dia: string | null;
	hora: string | null;
}

const EVENT_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['titulo', 'dia', 'hora'],
	properties: {
		titulo: { type: 'string' },
		dia: { type: ['string', 'null'] },
		hora: { type: ['string', 'null'] }
	}
};

const EVENT_LINE =
	'Si además cuenta un plan o una cita con día que convenga tener en la Agenda de la familia («el viernes vienen mis padres a las 11»), «cita» con «titulo» corto («Vienen los padres de Ana»), «dia» (AAAA-MM-DD) y «hora» (HH:MM, o null si no la dice); si no, «titulo» vacío y lo demás null.';

interface Learned {
	merece: boolean;
	recuerdo: string;
	hasta: string | null;
	cita: Event;
}

const SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['merece', 'recuerdo', 'hasta', 'cita'],
	properties: {
		merece: { type: 'boolean' },
		recuerdo: { type: 'string' },
		hasta: { type: ['string', 'null'] },
		cita: EVENT_SCHEMA
	}
};

const SYSTEM = (today: string, who: string) =>
	`Lees un mensaje de Telegram de ${who} y dices si tiene algo que merezca la pena recordar más adelante: un plan con fecha, una cita, un dato útil de la familia («llegamos el sábado a las 11», «el dentista es el martes a las 5», «la talla de Lucía ya es la 34»). Casi nunca: los saludos, las bromas, lo que solo vale ahora («ya voy»), las preguntas sin respuesta y la conversación, no. Hoy es ${dayName(today, true)} (${today}).
Si merece, «recuerdo» en una frase corta que se entienda sola, con nombres y fechas de verdad, sin «yo» ni «mañana» («Los padres de ${who} llegan el sábado 8 a las 11»), y «hasta» el último día que vale (AAAA-MM-DD), o null si vale siempre. Si no, «merece» false, «recuerdo» vacío y «hasta» null.
${EVENT_LINE}`;

/** The AI's answer: OpenRouter's, else the house's Ollama's; null if neither answers. */
async function read<T>(
	k: Kitchen,
	label: string,
	system: string,
	prompt: string,
	schema: Record<string, unknown>
): Promise<T | null> {
	const apiKey = await openRouterKey(k);
	if (apiKey)
		try {
			return await completeJson<T>({
				apiKey,
				label,
				system,
				prompt,
				name: 'learned',
				schema,
				maxTokens: 300,
				timeoutMs: 20_000
			});
		} catch (error) {
			console.warn('[aprender] OpenRouter no contesta: al salón', { error: String(error) });
		}
	if (!(await familyHasHouse(k.familyId))) return null;
	try {
		const { answer } = await sendHouse<{ answer: T }>(
			k.familyId,
			'/ia/json',
			{ method: 'POST', body: JSON.stringify({ system, prompt, schema }) },
			60_000
		);
		return answer;
	} catch (error) {
		console.warn('[aprender] El salón tampoco contesta', { error: String(error) });
		return null;
	}
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * An event told on the way (phase 7: «el viernes vienen mis padres a las 11»), offered for the
 * agenda in their «Buzón»; not one already there that day, nor one in the past.
 */
async function proposeEvent(k: Kitchen, userId: string, event: Event, because: string) {
	const title = event.titulo.trim().slice(0, 120);
	const day = event.dia && DAY.test(event.dia) ? event.dia : null;
	if (!title || !day || day < localDay()) return;
	const time = event.hora && TIME.test(event.hora) ? event.hora : null;
	const { occurrences } = await agendaBetween(k, day, day);
	if (occurrences.some((o) => sharesWords(title, { title: o.title, words: [] }))) return;
	await keepInInbox(k, [userId], {
		kind: 'propuesta',
		title: '📅 ¿Lo apunto en la Agenda?',
		body: `${title} · ${dayName(day)}${time ? `, ${time}` : ''}`,
		tag: `cita-${day}-${title.toLowerCase().slice(0, 60)}`,
		url: '/buzon',
		ttl: 0,
		proposal: { type: 'cita', title, day, time, because }
	});
}

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
	const learned = await read<Learned>(
		k,
		'Aprender de Telegram',
		SYSTEM(today, who),
		prompt,
		SCHEMA
	);
	const because = `de un mensaje de ${by} en «${said.chat}» en Telegram`;
	if (learned?.cita) await proposeEvent(k, userId, learned.cita, because);
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
		proposal: { text, untilDay, because }
	});
	console.info('[aprender] Propuesto', { userId, chat: said.chat });
	return text;
}

// ——— From what is said to the voice (phase 6) ———

interface Heard {
	merece: boolean;
	recuerdo: string;
	hasta: string | null;
	de_casa: boolean;
	sustituye: number | null;
	cita: Event;
}

const HEARD_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['merece', 'recuerdo', 'hasta', 'de_casa', 'sustituye', 'cita'],
	properties: {
		merece: { type: 'boolean' },
		recuerdo: { type: 'string' },
		hasta: { type: ['string', 'null'] },
		de_casa: { type: 'boolean' },
		sustituye: { type: ['integer', 'null'] },
		cita: EVENT_SCHEMA
	}
};

const HEARD_SYSTEM = (today: string, who: string | null) =>
	`Lees lo que ${who ?? 'alguien de la casa'} le ha dicho a la voz de casa y dices si, de paso, ha contado algo que merezca recordarse sin que lo pida: un plan con fecha, un dato de la familia o de la casa («mañana no hay cole, es fiesta», «a Lucía no le gustan las lentejas», «el viernes vienen mis padres»). Casi nunca: las órdenes («pon música», «qué hora es», «apaga la luz»), las preguntas, lo que solo vale ahora y lo que ya está en lo que recuerdas, no. Hoy es ${dayName(today, true)} (${today}).
Si merece, «recuerdo» en una frase corta que se entienda sola, con nombres y fechas de verdad, sin «yo» ni «mañana»; «hasta» el último día que vale (AAAA-MM-DD) o null si vale siempre; «de_casa» true si es de toda la casa y no solo de quien habla; y «sustituye» el número de lo que ya recuerdas que esto corrige («ahora la llave está en el cajón»), o null. Si no, «merece» false, «recuerdo» vacío, «hasta» y «sustituye» null.
${EVENT_LINE}`;

/** Orders shorter than this tell nothing («para», «sube el volumen»). */
const HEARD_MIN_CHARS = 15;

/**
 * After an order (`said`, and what the voice answered): if it told something worth remembering,
 * kept at once in their memory (the house's if it is everyone's; on a satellite, `userId` null,
 * only that), correcting what it says is old. Never for children (the caller sees to it).
 */
export async function learnFromOrder(
	k: Kitchen,
	userId: string | null,
	who: string | null,
	said: string,
	answered: string
) {
	if (said.trim().length < HEARD_MIN_CHARS) return null;
	const today = localDay();
	const known = pickLearned(
		(await listMemories(k, userId)).map((m) => ({ ...m, title: m.text })),
		said
	).slice(0, 10);
	const prompt = [
		`Ha dicho: «${said.trim().slice(0, 1000)}»`,
		`La voz ha contestado: «${answered.slice(0, 500)}»`,
		known.length
			? `Lo que ya recuerdas: ${known.map((m) => `${m.id}: ${m.text}`).join(' · ')}`
			: null
	]
		.filter(Boolean)
		.join('\n');
	const heard = await read<Heard>(
		k,
		'Aprender de lo hablado',
		HEARD_SYSTEM(today, who),
		prompt,
		HEARD_SCHEMA
	);
	// An event: offered to who said it (on a satellite, no one to ask).
	if (heard?.cita && userId)
		await proposeEvent(k, userId, heard.cita, 'de lo que dijiste a la voz');
	const text = heard?.merece ? heard.recuerdo.trim().slice(0, MAX_MEMORY) : '';
	if (!text) return null;
	// On a satellite, no one known: only what is everyone's.
	if (!userId && !heard!.de_casa) return null;
	const whose = heard!.de_casa ? null : userId;
	if (heard!.sustituye !== null && known.some((m) => m.id === heard!.sustituye))
		await forget(k, userId, heard!.sustituye);
	const untilDay =
		heard!.hasta && DAY.test(heard!.hasta) && heard!.hasta >= today ? heard!.hasta : null;
	await remember(
		k,
		whose,
		text,
		{ untilDay },
		{ source: 'conversacion', ruleId: null, because: 'de lo que se dijo a la voz', chain: [] }
	);
	console.info('[aprender] De lo hablado', { userId, house: whose === null });
	return text;
}

/** The day's summary goes at this time. */
export const SUMMARY_AT = '21:00';

/**
 * «Hoy he aprendido» (each day at `SUMMARY_AT`, scheduler.ts): to each grown-up, what the voice
 * learned today from what they said, and the house's; in their «Buzón», without a notice on the
 * phone, each to take out with ×. Nothing learned, nothing.
 */
export async function summarizeLearned(familyId: string) {
	const k = houseKitchen(familyId);
	const learned = await learnedToday(k);
	if (!learned.length) return;
	const adults = await asFamily(familyId, (tx) =>
		tx.select({ id: familyMember.userId }).from(familyMember).where(ne(familyMember.role, 'peque'))
	);
	for (const { id } of adults) {
		const theirs = learned.filter((m) => m.userId === id || m.userId === null);
		if (!theirs.length) continue;
		await keepInInbox(k, [id], {
			kind: 'aprendido',
			title: '🧠 Hoy he aprendido',
			body: theirs.map((m) => m.text).join(' · '),
			tag: `aprendido-${localDay()}`,
			url: '/buzon',
			ttl: 0,
			learned: theirs.map(({ id, text }) => ({ id, text }))
		});
	}
}

// ——— Rules for what repeats (phase 7) ———

interface Proposed {
	propuestas: { pregunta: string; regla: string }[];
}

const PROPOSED_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['propuestas'],
	properties: {
		propuestas: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['pregunta', 'regla'],
				properties: { pregunta: { type: 'string' }, regla: { type: 'string' } }
			}
		}
	}
};

const PROPOSE_SYSTEM = (who: string) =>
	`Miras lo que ${who} le ha dicho a la voz de casa estas dos semanas, lo que recuerda, lo que hay en la nevera y sus reglas, y propones como mucho dos reglas nuevas para lo que se repite de verdad (tres veces o más) o para algo que claramente le vendría bien. Una regla se comprueba sola: cuando dice algo con ciertas palabras, cuando se pone algo en la nevera, cuando se recuerda algo, cuando empieza una cita de la Agenda o un viaje, cada día a una hora, cuando va a llover, helar, hacer calor o viento, o cuando una toma de Medicación sigue sin marcar; puede depender de estar de viaje, de lo que se recuerda, de la nevera, de la Agenda de hoy o del tiempo; y avisa, o deduce un dato para otras reglas («si digo que pongo la lavadora, ese día hay ropa tendida»).
Nada que ya haga una de sus reglas ni que ya se le haya propuesto, nada de salud más allá de recordar lo apuntado, nada sobre otras personas que no sea de la casa. «regla» como la diría ${who}, en primera persona; «pregunta», corta y en segunda persona, para que diga sí o no («¿Sueles tender la ropa el día que pones la lavadora?»). Si no ves nada claro, ninguna: es lo normal.`;

/** Less said than this in two weeks: nothing to see repeat. */
const PROPOSE_MIN_HEARD = 5;
const MAX_PROPOSED = 2;

/**
 * Each evening (scheduler.ts, after «Hoy he aprendido»): to each grown-up who talked to the voice
 * enough these days, at most two rules for what repeats, offered in their «Buzón» with «Sí, créala»
 * and «No»; never one offered before. Read by OpenRouter, or the house's Ollama if it fails.
 */
export async function proposeRules(familyId: string) {
	const adults = await asFamily(familyId, (tx) =>
		tx.select({ id: familyMember.userId }).from(familyMember).where(ne(familyMember.role, 'peque'))
	);
	for (const { id } of adults) {
		try {
			const k = await kitchenOf(id);
			const said = await heardOf(k, id);
			if (said.length < PROPOSE_MIN_HEARD) continue;
			const [memories, fridge, rules, inbox, [me]] = await Promise.all([
				listMemories(k, id),
				fridgeState(k),
				listRules(k, id),
				listInbox(k, id),
				asFamily(familyId, (tx) => tx.select({ name: user.name }).from(user).where(eq(user.id, id)))
			]);
			const offered = inbox.filter((n) => n.tag?.startsWith('regla-propuesta-')).map((n) => n.body);
			const prompt = [
				`Lo que ha dicho a la voz: ${said.map((h) => `[${dayName(localDay(h.at))}] ${h.text}`).join(' · ')}`,
				memories.length ? `Lo que recuerda: ${memories.map((m) => m.text).join(' · ')}` : null,
				fridge.notes.length ? `En la nevera: ${fridge.notes.map((n) => n.text).join(' · ')}` : null,
				rules.length ? `Sus reglas: ${rules.map((r) => r.understood).join(' · ')}` : null,
				offered.length ? `Ya propuesto: ${offered.join(' · ')}` : null
			]
				.filter(Boolean)
				.join('\n');
			const proposed = await read<Proposed>(
				k,
				'Proponer reglas',
				PROPOSE_SYSTEM(me?.name ?? 'quien habla'),
				prompt.slice(0, 12_000),
				PROPOSED_SCHEMA
			);
			for (const p of (proposed?.propuestas ?? []).slice(0, MAX_PROPOSED)) {
				const question = p.pregunta.trim().slice(0, 200);
				const rule = p.regla.trim().slice(0, 500);
				if (!question || !rule || offered.includes(rule)) continue;
				await keepInInbox(k, [id], {
					kind: 'propuesta',
					title: `💡 ${question}`,
					body: rule,
					tag: `regla-propuesta-${rule.toLowerCase().slice(0, 80)}`,
					url: '/buzon',
					ttl: 0,
					proposal: { type: 'regla', said: rule, because: 'por lo que se repite estos días' }
				});
			}
		} catch (error) {
			console.warn('[aprender] No se pudieron proponer reglas', {
				userId: id,
				error: String(error)
			});
		}
	}
}
