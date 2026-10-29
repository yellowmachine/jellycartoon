import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { fold } from 'comun/music.ts';
import type { VoiceOption } from 'comun/voice.ts';
import { voiceLearned } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { completeJson } from '#lib/server/openrouter.ts';

/**
 * What the voice learns from its own questions: «media hora», said to the bedroom's satellite, it
 * asked «¿un temporizador o parar la música?», and «un temporizador» was the answer. Then the AI
 * writes it as a rule for that place, and the next orders said there take the rules that share
 * their words: no question again. Looked up before the model, by words, not by a tool: a tool
 * would be one more turn with it (about a second), and each place has only a few.
 */

/** After the question, how long its answer may take. */
const ANSWER_MS = 2 * 60_000;
/** Up to so many, all of the place's go with every order; past them, those that share words. */
const ALL_UP_TO = 12;
/** And of those, so many. */
const BEST = 5;
const MAX_TITLE = 80;
const MAX_RULE = 300;
const MAX_WORDS = 12;

export interface Learned {
	id: number;
	place: string;
	placeName: string;
	title: string;
	rule: string;
	words: string[];
}

/** Their words, accents and case aside; short ones («de», «la») say nothing. */
export const wordsOf = (text: string) =>
	fold(text)
		.split(/[^\p{L}\p{N}]+/u)
		.filter((w) => w.length > 2);

/** The same, or the same first five letters: «minuto» and «minutos», «temporizador» and «temporizadores». */
const near = (a: string, b: string) =>
	a === b || (a.length >= 5 && a.slice(0, 5) === b.slice(0, 5));

/** How many of `said`'s words a rule has, among its words and its title. */
const score = (said: string[], l: Pick<Learned, 'title' | 'words'>) => {
	const own = [...l.words.flatMap(wordsOf), ...wordsOf(l.title)];
	return said.filter((w) => own.some((o) => near(w, o))).length;
};

/**
 * Whether an order has to do with it, by its words: «para» has nothing of «la radio es la COPE»,
 * though the model said it went by it (it stopped the radio).
 */
export const sharesWords = (said: string, l: Pick<Learned, 'title' | 'words'>) =>
	score(wordsOf(said), l) > 0;

/**
 * Those for an order: all of the place's while they are few; else the ones that share most words
 * with it (newest first if they tie), and none that shares none. `learned`, newest first.
 */
export function pickLearned<T extends Pick<Learned, 'title' | 'words'>>(
	learned: T[],
	said: string
): T[] {
	if (learned.length <= ALL_UP_TO) return learned;
	const words = wordsOf(said);
	return learned
		.map((l, i) => ({ l, i, s: score(words, l) }))
		.filter(({ s }) => s > 0)
		.sort((a, b) => b.s - a.s || a.i - b.i)
		.slice(0, BEST)
		.map(({ l }) => l);
}

const COLUMNS = {
	id: voiceLearned.id,
	place: voiceLearned.place,
	placeName: voiceLearned.placeName,
	title: voiceLearned.title,
	rule: voiceLearned.rule,
	words: voiceLearned.words
};

async function ofPlace(k: Kitchen, place: string): Promise<Learned[]> {
	return k.run((tx) =>
		tx
			.select(COLUMNS)
			.from(voiceLearned)
			.where(and(eq(voiceLearned.familyId, k.familyId), eq(voiceLearned.place, place)))
			.orderBy(desc(voiceLearned.hits), desc(voiceLearned.updatedAt))
	);
}

/**
 * For the order's message: what was learned here that may matter, by its number, which the model
 * gives back (`used_learned`) when it does something by one; null if nothing.
 */
export async function recallLearned(k: Kitchen, place: string | null, said: string) {
	if (!place) return null;
	const picked = pickLearned(await ofPlace(k, place), said);
	if (!picked.length) return null;
	return {
		picked,
		text: `[Aprendido aquí de otras veces, cuando preguntaste: haz caso sin volver a preguntar si viene al caso y di lo que haces, para que se pueda corregir. Solo cuando una de estas decide algo que, sin ella, habrías preguntado, llama a la vez a «used_learned» con su número; nunca en una orden que está clara sin ellas («para», «sube el volumen»). ${picked.map((l) => `#${l.id} «${l.title}»: ${l.rule}`).join(' ')}]`
	};
}

/** Done by them: one more time each. Never fails: it only orders them. */
export function countHits(k: Kitchen, ids: number[]) {
	if (!ids.length) return;
	k.run((tx) =>
		tx
			.update(voiceLearned)
			.set({ hits: sql`${voiceLearned.hits} + 1` })
			.where(and(eq(voiceLearned.familyId, k.familyId), inArray(voiceLearned.id, ids)))
	).catch((err) => console.warn('[voz] aprendido sin contar:', err));
}

type Used = Pick<Learned, 'id' | 'title' | 'rule'>;

/**
 * By family and place: the question asked there, waiting for its answer; or what was done by
 * what was learned, open to a correction.
 */
const pending = new Map<
	string,
	| { kind: 'asked'; said: string; question: string; options: VoiceOption[]; at: number }
	| { kind: 'assumed'; said: string; reply: string; used: Used[]; at: number }
>();

export type Followed =
	| {
			kind: 'answer';
			said: string;
			question: string;
			options: VoiceOption[];
			answer: string;
			reply: string;
	  }
	| { kind: 'after'; said: string; reply: string; used: Used[]; next: string; nextReply: string };

/**
 * For the next order's message, before the model: what the place's last one did by what was
 * learned, in case this corrects it; null if nothing (or too long ago).
 */
export function assumedNote(key: string) {
	const before = pending.get(key);
	if (before?.kind !== 'assumed' || Date.now() - before.at > ANSWER_MS) return null;
	return `[La orden anterior («${before.said}» → «${before.reply}») la hiciste por lo aprendido: ${before.used.map((u) => `«${u.title}»`).join(', ')}. Si esta la corrige («no», «eso no», «que pares la música»), deshaz lo que hiciste si hace falta y haz lo que pide, sin preguntar; si no, como siempre.]`;
}

/**
 * After each order of a place: a question is kept, and what was done by what was learned
 * (`used`). The next order, within `ANSWER_MS`, follows it: the answer to the question (if not
 * one more), or what came after the assumption; given back to learn from.
 */
export function afterOrder(
	key: string,
	said: string,
	reply: { reply: string; options: VoiceOption[]; expectsAnswer: boolean },
	used: Used[]
): Followed | null {
	const t = Date.now();
	const before = pending.get(key);
	pending.delete(key);
	// Asked again (it did not understand the answer): still about the first order, «pon la radio»,
	// not about «la Coppa».
	const first = before?.kind === 'asked' && t - before.at <= ANSWER_MS ? before.said : said;
	if (reply.expectsAnswer)
		pending.set(key, {
			kind: 'asked',
			said: first,
			question: reply.reply,
			options: reply.options,
			at: t
		});
	else if (used.length)
		pending.set(key, { kind: 'assumed', said, reply: reply.reply, used, at: t });
	if (!before || t - before.at > ANSWER_MS) return null;
	if (before.kind === 'assumed')
		return {
			kind: 'after',
			said: before.said,
			reply: before.reply,
			used: before.used,
			next: said,
			nextReply: reply.reply
		};
	if (reply.expectsAnswer) return null;
	return {
		kind: 'answer',
		said: before.said,
		question: before.question,
		options: before.options,
		answer: said,
		reply: reply.reply
	};
}

interface Lesson {
	learn: boolean;
	/** One of the place's, to write again (it said otherwise this time); 0, a new one. */
	replaces: number;
	/** One of the place's, forgotten: corrected, and with no clear rule; 0, none. */
	forget: number;
	title: string;
	rule: string;
	words: string[];
}

const LESSON_SCHEMA = {
	type: 'object',
	properties: {
		learn: { type: 'boolean' },
		replaces: { type: 'integer' },
		forget: { type: 'integer' },
		title: { type: 'string' },
		rule: { type: 'string' },
		words: { type: 'array', items: { type: 'string' } }
	},
	required: ['learn', 'replaces', 'forget', 'title', 'rule', 'words'],
	additionalProperties: false
};

const HOW_TO_WRITE = `- «title»: corto, para leerlo en una lista: «Una duración sola es un temporizador».
- «rule»: una frase para el asistente, con un ejemplo de lo dicho: «Si dice solo una duración ("media hora", "diez minutos"), pon un temporizador; no pares la música».
- «words»: palabras sueltas, en minúscula, que traería otra vez una orden así, también las de su familia: «media», «hora», «minutos», «segundos».`;

const LESSON_SYSTEM = `Eres la memoria del asistente de voz de una casa. El asistente no tenía claro qué le pedían, preguntó, y le contestaron. Decide si de eso se aprende algo para la próxima vez en el mismo sitio, para no volver a preguntar.

- Aprende («learn»: true) solo una costumbre de cómo se habla ahí: «media hora» a secas es un temporizador; «la radio» es Radio 3. Generaliza un poco si se ve claro («una duración sola», no solo «media hora»), pero no inventes.
- No aprendas («learn»: false) si la respuesta depende del momento (qué canción ahora, qué capítulo hoy), si no contesta a la pregunta (cambia de tema, «déjalo»), o si no se ve qué eligió.
${HOW_TO_WRITE}
- «replaces»: si una de las ya aprendidas es de lo mismo, su número, y escríbela entera de nuevo (con lo de ahora, que manda si dicen lo contrario); si no, 0.
- «forget»: 0.`;

const CORRECTION_SYSTEM = `Eres la memoria del asistente de voz de una casa. El asistente hizo algo sin preguntar, por una costumbre que había aprendido en ese sitio, y justo después le dijeron algo. Decide si eso corrige la costumbre.

- Si no la corrige (otra orden sin relación, «gracias», una frase suelta de la tele): «learn»: false y «forget»: 0.
- Si la corrige y se ve cuál es la costumbre buena: «learn»: true, «replaces» con su número y la costumbre escrita entera de nuevo (lo de ahora manda). «forget»: 0.
- Si la corrige pero no queda claro qué se quiere en general (a veces una cosa, a veces otra): «learn»: false y «forget» con su número, para que vuelva a preguntar.
${HOW_TO_WRITE}`;

const promptOf = (f: Followed, known: Learned[]) =>
	[
		...(f.kind === 'answer'
			? [
					`Dicho: «${f.said}»`,
					`Preguntó: «${f.question}»${f.options.length ? ` (opciones: ${f.options.map((o) => `«${o.label}»`).join(', ')})` : ''}`,
					`Contestaron: «${f.answer}»`,
					`Y el asistente: «${f.reply}»`
				]
			: [
					`Dicho: «${f.said}»`,
					`El asistente, por lo aprendido (${f.used.map((u) => `${u.id}`).join(', ')}): «${f.reply}»`,
					`Después dijeron: «${f.next}»`,
					`Y el asistente: «${f.nextReply}»`
				]),
		known.length
			? `Ya aprendidas aquí:\n${known.map((l) => `${l.id}. «${l.title}»: ${l.rule}`).join('\n')}`
			: 'Aquí aún no hay ninguna aprendida.'
	].join('\n');

/**
 * The AI's lesson from a question and its answer, or from what followed an assumption: saved for
 * the place, one of its own written again, or forgotten. After the order is answered: no one
 * waits for it. False if nothing changed.
 */
export async function learnFrom(
	k: Kitchen,
	apiKey: string,
	place: string,
	placeName: string,
	f: Followed
) {
	const known = await ofPlace(k, place);
	const lesson = await completeJson<Lesson>({
		apiKey,
		label: f.kind === 'answer' ? 'Voz: aprender' : 'Voz: corregir lo aprendido',
		system: f.kind === 'answer' ? LESSON_SYSTEM : CORRECTION_SYSTEM,
		prompt: promptOf(f, known),
		name: 'lesson',
		schema: LESSON_SCHEMA,
		maxTokens: 400,
		timeoutMs: 30_000
	});
	// Only those it was shown, and after an assumption only those it was done by.
	const own = (id: number) =>
		(f.kind === 'answer' || f.used.some((u) => u.id === id)) && known.some((l) => l.id === id);
	const title = lesson.title.trim().slice(0, MAX_TITLE);
	const rule = lesson.rule.trim().slice(0, MAX_RULE);
	if (!lesson.learn || !title || !rule) {
		if (f.kind !== 'after' || !own(lesson.forget)) return false;
		await forgetLearned(k, lesson.forget);
		return true;
	}
	const replaces = own(lesson.replaces) ? lesson.replaces : null;
	// A correction writes one of its own again, never a new one beside it.
	if (f.kind === 'after' && !replaces) return false;
	const words = [...new Set(lesson.words.flatMap(wordsOf))].slice(0, MAX_WORDS);
	const row = { title, rule, words, placeName, updatedAt: new Date() };
	await k.run((tx) =>
		replaces
			? tx
					.update(voiceLearned)
					// Corrected, it starts again.
					.set(f.kind === 'after' ? { ...row, hits: 0 } : row)
					.where(eq(voiceLearned.id, replaces))
			: tx.insert(voiceLearned).values({ familyId: k.familyId, place, ...row })
	);
	return true;
}

/** All of the family's, by place, for Ajustes. */
export async function listLearned(k: Kitchen): Promise<Learned[]> {
	return k.run((tx) =>
		tx
			.select(COLUMNS)
			.from(voiceLearned)
			.where(eq(voiceLearned.familyId, k.familyId))
			.orderBy(voiceLearned.placeName, desc(voiceLearned.updatedAt))
	);
}

/** Forgotten, from Ajustes. */
export async function forgetLearned(k: Kitchen, id: number) {
	await k.run((tx) =>
		tx
			.delete(voiceLearned)
			.where(and(eq(voiceLearned.familyId, k.familyId), eq(voiceLearned.id, id)))
	);
}
