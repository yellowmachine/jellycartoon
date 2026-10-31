import { dayName, localDay, localTime } from 'comun/agenda.ts';
import { openRouterKey } from '#lib/server/family-settings.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { familyHasHouse, sendHouse } from '#lib/server/house.ts';
import { familyMember, user } from '#lib/server/db/schema.ts';
import { asFamily } from '#lib/server/family.ts';
import { keepInInbox, listInbox } from '#lib/server/inbox-store.ts';
import { heardOf, markLearned, pendingHeard } from '#lib/server/heard.ts';
import { listRules } from '#lib/server/rules.ts';
import { fridgeState, houseKitchen, kitchenOf } from '#lib/server/fridge.ts';
import { forget, learnedToday, listMemories, MAX_MEMORY, remember } from '#lib/server/memory.ts';
import { agendaBetween } from '#lib/server/agenda/agenda.ts';
import { pickLearned, sharesWords } from '#lib/server/voice/learned.ts';
import { eq, ne } from 'drizzle-orm';
import { completeJson } from '#lib/server/openrouter.ts';
import { inBackground, quietFor } from '#lib/server/ai-lane.ts';

/**
 * What a Telegram message has worth remembering (#331, phase 5): one of the chats a person chose
 * (the house's Ajustes → Telegram), passed by the house in their name. Read by the family's AI in
 * OpenRouter, or, if it fails, by the house's Ollama (its /api/v1/ia/json); almost always nothing.
 * When there is something («llegamos el sábado a las 11»), it is offered in their «Buzón», with
 * «Guardar» and «No»: kept, it goes to their own memory, never on its own.
 *
 * And what is said to the voice (phase 6, if the family has it on): each order queued (heard.ts)
 * and read by batches once the voice is quiet (`learnPending`), whether it told something worth
 * remembering without «recuerda» («mañana no hay cole, es fiesta»): kept at once, marked as
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
			// Behind the voice: never taking its room in OpenRouter (ai-lane.ts).
			return await inBackground(() =>
				completeJson<T>({
					apiKey,
					label,
					system,
					prompt,
					name: 'learned',
					schema,
					maxTokens: 300,
					timeoutMs: 20_000
				})
			);
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

/** One thing learned from a few orders: something to remember, an event, or both. */
interface HeardItem {
	recuerdo: string;
	hasta: string | null;
	de_casa: boolean;
	sustituye: number | null;
	cita: Event;
}

interface Heard {
	aprendido: HeardItem[];
}

const HEARD_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['aprendido'],
	properties: {
		aprendido: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['recuerdo', 'hasta', 'de_casa', 'sustituye', 'cita'],
				properties: {
					recuerdo: { type: 'string' },
					hasta: { type: ['string', 'null'] },
					de_casa: { type: 'boolean' },
					sustituye: { type: ['integer', 'null'] },
					cita: EVENT_SCHEMA
				}
			}
		}
	}
};

const HEARD_SYSTEM = (today: string, who: string | null) =>
	`Lees lo que ${who ?? 'alguien de la casa'} le ha dicho a la voz de casa estas últimas horas, orden a orden con la hora y lo que contestó la voz, y dices si, de paso, ha contado algo que merezca recordarse sin pedirlo: un plan con fecha, un dato de la familia o de la casa («mañana no hay cole, es fiesta», «a Lucía no le gustan las lentejas», «el viernes vienen mis padres»). Casi nunca: las órdenes («pon música», «qué hora es», «apaga la luz»), las preguntas, lo que solo valía en ese momento y lo que ya está en lo que recuerdas, no. Lo de varias órdenes que va junto («el viernes vienen mis padres», «a las 11»), en una sola cosa. Hoy es ${dayName(today, true)} (${today}).
Por cada cosa (normalmente ninguna, «aprendido» vacío): «recuerdo» en una frase corta que se entienda sola, con nombres y fechas de verdad, sin «yo» ni «mañana» (vacío si solo es una cita); «hasta» el último día que vale (AAAA-MM-DD) o null si vale siempre; «de_casa» true si es de toda la casa y no solo de quien habla; y «sustituye» el número de lo que ya recuerdas que esto corrige («ahora la llave está en el cajón»), o null.
${EVENT_LINE}`;

/** Orders shorter than this tell nothing («para», «sube el volumen»): not queued. */
export const HEARD_MIN_CHARS = 15;

/**
 * A few orders of one person (`userId` null: said on satellites) that may have told something
 * worth remembering, read together: what there is, kept at once in their memory (the house's if
 * it is everyone's; on a satellite, only that), correcting what it says is old; an event, offered
 * for the agenda. False if no AI answered (they stay in the queue).
 */
export async function learnFromHeard(
	k: Kitchen,
	userId: string | null,
	who: string | null,
	said: { text: string; answer: string | null; at: Date }[]
) {
	const today = localDay();
	const known = pickLearned(
		(await listMemories(k, userId)).map((m) => ({ ...m, title: m.text })),
		said.map((s) => s.text).join(' ')
	).slice(0, 10);
	const prompt = [
		...said.map(
			(s) =>
				`[${dayName(localDay(s.at))}, ${localTime(s.at)}] Ha dicho: «${s.text}»${s.answer ? ` → la voz: «${s.answer}»` : ''}`
		),
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
		prompt.slice(0, 12_000),
		HEARD_SCHEMA
	);
	if (!heard) return false;
	for (const item of heard.aprendido ?? []) {
		// An event: offered to who said it (on a satellite, no one to ask).
		if (item.cita && userId) await proposeEvent(k, userId, item.cita, 'de lo que dijiste a la voz');
		const text = item.recuerdo.trim().slice(0, MAX_MEMORY);
		// On a satellite, no one known: only what is everyone's.
		if (!text || (!userId && !item.de_casa)) continue;
		const whose = item.de_casa ? null : userId;
		if (item.sustituye !== null && known.some((m) => m.id === item.sustituye))
			await forget(k, userId, item.sustituye);
		const untilDay = item.hasta && DAY.test(item.hasta) && item.hasta >= today ? item.hasta : null;
		await remember(
			k,
			whose,
			text,
			{ untilDay },
			{ source: 'conversacion', ruleId: null, because: 'de lo que se dijo a la voz', chain: [] }
		);
		console.info('[aprender] De lo hablado', { userId, house: whose === null });
	}
	return true;
}

/** The family's voice quiet this long: then what is queued is learned from. */
const QUIET_MS = 2 * 60_000;
/** At most this many orders in one reading. */
const BATCH = 20;
/** Queued longer than this and no AI answered: given up. */
const GIVE_UP_MS = 24 * 3600_000;

/**
 * Every minute (scheduler.ts): what is queued to learn from (heard.ts), once the family's voice
 * has been quiet a while (ai-lane.ts), one person at a time, a few orders in each reading. Away
 * from the voice, in OpenRouter's background lane.
 */
export async function learnPending(familyId: string) {
	const k = houseKitchen(familyId);
	const apiKey = await openRouterKey(k);
	if (apiKey && quietFor(apiKey) < QUIET_MS) return;
	const pending = await pendingHeard(k);
	if (!pending.length) return;
	const byPerson = new Map<string | null, typeof pending>();
	for (const p of pending) byPerson.set(p.userId, [...(byPerson.get(p.userId) ?? []), p]);
	for (const [userId, rows] of byPerson) {
		const batch = rows.slice(0, BATCH);
		const pk = userId ? await kitchenOf(userId) : k;
		const [me] = userId
			? await asFamily(familyId, (tx) =>
					tx.select({ name: user.name }).from(user).where(eq(user.id, userId))
				)
			: [];
		const done = await learnFromHeard(pk, userId, me?.name ?? null, batch);
		const old = batch.filter((b) => Date.now() - b.at.getTime() > GIVE_UP_MS);
		await markLearned(
			k,
			(done ? batch : old).map((b) => b.id)
		);
	}
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
