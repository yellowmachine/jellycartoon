import { and, desc, eq } from 'drizzle-orm';
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
			.orderBy(desc(voiceLearned.updatedAt))
	);
}

/** For the order's message: what was learned here that may matter; null if nothing. */
export async function recallLearned(k: Kitchen, place: string | null, said: string) {
	if (!place) return null;
	const picked = pickLearned(await ofPlace(k, place), said);
	if (!picked.length) return null;
	return `[Aprendido aquí de otras veces, cuando preguntaste (haz caso sin volver a preguntar si viene al caso, y di lo que haces, para que se pueda corregir): ${picked.map((l) => `«${l.title}»: ${l.rule}`).join(' ')}]`;
}

/** By family and place: the question asked there, waiting for its answer. */
const asking = new Map<
	string,
	{ said: string; question: string; options: VoiceOption[]; at: number }
>();

export interface Answered {
	said: string;
	question: string;
	options: VoiceOption[];
	answer: string;
	reply: string;
}

/**
 * After each order of a place: a question is kept; the next order, within `ANSWER_MS` and not one
 * more question, is its answer, given back to learn from. Also when another one: it is the new
 * question.
 */
export function afterOrder(
	key: string,
	said: string,
	reply: { reply: string; options: VoiceOption[]; expectsAnswer: boolean }
): Answered | null {
	const t = Date.now();
	const before = asking.get(key);
	asking.delete(key);
	if (reply.expectsAnswer) {
		asking.set(key, { said, question: reply.reply, options: reply.options, at: t });
		return null;
	}
	if (!before || t - before.at > ANSWER_MS) return null;
	const { at: _, ...question } = before;
	return { ...question, answer: said, reply: reply.reply };
}

interface Lesson {
	learn: boolean;
	/** One of the place's, to write again (it said otherwise this time); 0, a new one. */
	replaces: number;
	title: string;
	rule: string;
	words: string[];
}

const LESSON_SCHEMA = {
	type: 'object',
	properties: {
		learn: { type: 'boolean' },
		replaces: { type: 'integer' },
		title: { type: 'string' },
		rule: { type: 'string' },
		words: { type: 'array', items: { type: 'string' } }
	},
	required: ['learn', 'replaces', 'title', 'rule', 'words'],
	additionalProperties: false
};

const LESSON_SYSTEM = `Eres la memoria del asistente de voz de una casa. El asistente no tenía claro qué le pedían, preguntó, y le contestaron. Decide si de eso se aprende algo para la próxima vez en el mismo sitio, para no volver a preguntar.

- Aprende («learn»: true) solo una costumbre de cómo se habla ahí: «media hora» a secas es un temporizador; «la radio» es Radio 3. Generaliza un poco si se ve claro («una duración sola», no solo «media hora»), pero no inventes.
- No aprendas («learn»: false) si la respuesta depende del momento (qué canción ahora, qué capítulo hoy), si no contesta a la pregunta (cambia de tema, «déjalo»), o si no se ve qué eligió.
- «title»: corto, para leerlo en una lista: «Una duración sola es un temporizador».
- «rule»: una frase para el asistente, con un ejemplo de lo dicho: «Si dice solo una duración ("media hora", "diez minutos"), pon un temporizador; no pares la música».
- «words»: palabras sueltas, en minúscula, que traería otra vez una orden así, también las de su familia: «media», «hora», «minutos», «segundos».
- «replaces»: si una de las ya aprendidas es de lo mismo, su número, y escríbela entera de nuevo (con lo de ahora, que manda si dicen lo contrario); si no, 0.`;

/**
 * The AI's lesson from a question and its answer, saved for the place (or one of its own written
 * again). After the order is answered: no one waits for it. False if there was none.
 */
export async function learnFrom(
	k: Kitchen,
	apiKey: string,
	place: string,
	placeName: string,
	a: Answered
) {
	const known = await ofPlace(k, place);
	const lesson = await completeJson<Lesson>({
		apiKey,
		label: 'Voz: aprender',
		system: LESSON_SYSTEM,
		prompt: [
			`Dicho: «${a.said}»`,
			`Preguntó: «${a.question}»${a.options.length ? ` (opciones: ${a.options.map((o) => `«${o.label}»`).join(', ')})` : ''}`,
			`Contestaron: «${a.answer}»`,
			`Y el asistente: «${a.reply}»`,
			known.length
				? `Ya aprendidas aquí:\n${known.map((l) => `${l.id}. «${l.title}»: ${l.rule}`).join('\n')}`
				: 'Aquí aún no hay ninguna aprendida.'
		].join('\n'),
		name: 'lesson',
		schema: LESSON_SCHEMA,
		maxTokens: 400,
		timeoutMs: 30_000
	});
	const title = lesson.title.trim().slice(0, MAX_TITLE);
	const rule = lesson.rule.trim().slice(0, MAX_RULE);
	if (!lesson.learn || !title || !rule) return false;
	const words = [...new Set(lesson.words.flatMap(wordsOf))].slice(0, MAX_WORDS);
	const row = { title, rule, words, placeName, updatedAt: new Date() };
	const replaced = known.find((l) => l.id === lesson.replaces);
	await k.run((tx) =>
		replaced
			? tx.update(voiceLearned).set(row).where(eq(voiceLearned.id, replaced.id))
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
