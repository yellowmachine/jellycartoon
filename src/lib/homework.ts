import type { Cue } from './vtt.ts';

/**
 * Homework from the cartoons they watched (#142): exercises the AI proposes from an episode's
 * subtitles, an adult reviews, and a child does on the tablet or the computer. Shared by the server
 * and the pages: what an exercise is, what the AI's answer must look like to become one, and how
 * the child's answers are marked.
 */

/** Choose one of a few; true or false; or a short answer of their own, that an adult reads. */
export type ExerciseKind = 'choice' | 'truefalse' | 'open';

export interface Exercise {
	kind: ExerciseKind;
	/** The question, as the child reads it (or hears it, in Infantil). */
	question: string;
	/** Closed ones, in the order shown; empty for `open`. */
	options: string[];
	/** Index into `options` of the right one; null for `open`. */
	answer: number | null;
	/** Said after a wrong try, before trying again: what to remember, not the answer. */
	hint: string | null;
	/** For `open`: what a good answer says, for the adult who reads it. */
	expected: string | null;
	/** The episode it is about, and where in it (seconds), for a frame or to watch it again. */
	episodeId: number;
	at: number | null;
}

/** Spanish, or English to practise it: the adult chooses for each homework. */
export type HomeworkLanguage = 'es' | 'en';

/** The two options of a `truefalse`, in the homework's language. */
export const TRUE_FALSE: Record<HomeworkLanguage, readonly [string, string]> = {
	es: ['Verdadero', 'Falso'],
	en: ['True', 'False']
};

/**
 * The ages, as the school's stages: what each can do. A first idea, to check with a teacher (#142):
 * how many questions, of which kinds, and with how many options.
 */
export const AGE_BANDS = [
	{
		id: 'infantil',
		label: 'Infantil (3 a 6 años)',
		reads: false,
		kinds: ['choice', 'truefalse'],
		options: 2,
		questions: 4
	},
	{
		id: 'primaria-1',
		label: 'Primaria, 1.º y 2.º (6 a 8 años)',
		reads: true,
		kinds: ['choice', 'truefalse'],
		options: 3,
		questions: 6
	},
	{
		id: 'primaria-2',
		label: 'Primaria, desde 3.º (8 a 12 años)',
		reads: true,
		kinds: ['choice', 'truefalse', 'open'],
		options: 4,
		questions: 8
	}
] as const satisfies readonly {
	id: string;
	label: string;
	/** Reads on their own; if not, everything is read aloud and answered by touching. */
	reads: boolean;
	kinds: readonly ExerciseKind[];
	/** Options in a `choice`. */
	options: number;
	/** How many, by default. */
	questions: number;
}[];

export type AgeBand = (typeof AGE_BANDS)[number];
export type AgeBandId = AgeBand['id'];

export const ageBand = (id: unknown) => AGE_BANDS.find((b) => b.id === id) ?? null;

export const MAX_QUESTION = 300;
export const MAX_OPTION = 120;
export const MAX_QUESTIONS = 15;

/** «12:34» (or «1:02:03»), as in the transcript the AI reads: where it is in the episode. */
export function clock(seconds: number) {
	const s = Math.max(0, Math.floor(seconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const pad = (n: number) => String(n).padStart(2, '0');
	return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** «12:34» back to seconds; null if it is not one. */
export function fromClock(text: unknown): number | null {
	if (typeof text !== 'string') return null;
	const parts = text.trim().split(':');
	if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d{1,2}$/.test(p))) return null;
	return parts.reduce((total, p) => total * 60 + Number(p), 0);
}

/**
 * An episode's dialogue for the AI, a line per subtitle with where it is: «[12:34] Text». Songs and
 * sound tags («♪», «[risas]») out; a line said again right after, once. Cut at `maxChars`, so that
 * several episodes fit in one question.
 */
export function transcript(cues: Cue[], maxChars = 40_000) {
	const lines: string[] = [];
	let length = 0;
	let last = '';
	for (const cue of cues) {
		const text = cue.text
			.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
		if (!text || /[♪♫]/.test(text) || text === last) continue;
		last = text;
		const line = `[${clock(cue.start)}] ${text}`;
		if (length + line.length + 1 > maxChars) break;
		lines.push(line);
		length += line.length + 1;
	}
	return lines.join('\n');
}

/** What the AI sends for each exercise (schema in server/homework.ts), before it is checked. */
export interface ProposedExercise {
	kind?: unknown;
	question?: unknown;
	options?: unknown;
	answer?: unknown;
	hint?: unknown;
	expected?: unknown;
	episode?: unknown;
	at?: unknown;
}

const text = (value: unknown, max: number) =>
	typeof value === 'string' && value.trim()
		? value.replace(/\s+/g, ' ').trim().slice(0, max)
		: null;

/**
 * The AI's proposal, as exercises that can be shown: those that do not hold together are left out
 * (no question, an answer that is not among the options, an episode that was not asked for, a kind
 * this age does not do). The right option is put in a random place, as models tend to put it first;
 * `random` is for the tests.
 */
export function checkProposal(
	proposed: unknown,
	{
		band,
		episodeIds,
		language = 'es'
	}: { band: AgeBand; episodeIds: number[]; language?: HomeworkLanguage },
	random: () => number = Math.random
): Exercise[] {
	if (!Array.isArray(proposed)) return [];
	const exercises: Exercise[] = [];
	const seen = new Set<string>();
	for (const p of proposed as ProposedExercise[]) {
		if (exercises.length >= MAX_QUESTIONS) break;
		const kind = p?.kind;
		if (kind !== 'choice' && kind !== 'truefalse' && kind !== 'open') continue;
		if (!(band.kinds as readonly ExerciseKind[]).includes(kind)) continue;
		const question = text(p.question, MAX_QUESTION);
		if (!question || seen.has(question.toLowerCase())) continue;
		const episodeId = Number(p.episode);
		if (!episodeIds.includes(episodeId)) continue;
		const at = fromClock(p.at);
		const hint = text(p.hint, MAX_QUESTION);

		let options: string[] = [];
		let answer: number | null = null;
		let expected: string | null = null;
		if (kind === 'truefalse') {
			if (typeof p.answer !== 'boolean') continue;
			options = [...TRUE_FALSE[language]];
			answer = p.answer ? 0 : 1;
		} else if (kind === 'choice') {
			if (!Array.isArray(p.options)) continue;
			const all = p.options.map((o) => text(o, MAX_OPTION));
			const right = typeof p.answer === 'number' ? all[p.answer] : null;
			const unique = [...new Set(all.filter((o): o is string => o !== null))];
			if (!right || unique.length !== all.length || unique.length < 2) continue;
			// As many as this age has: the right one and the first wrong ones.
			const wrong = unique.filter((o) => o !== right).slice(0, band.options - 1);
			options = [...wrong];
			answer = Math.floor(random() * (wrong.length + 1));
			options.splice(answer, 0, right);
		} else {
			expected = text(p.expected, MAX_QUESTION);
		}
		seen.add(question.toLowerCase());
		exercises.push({ kind, question, options, answer, hint, expected, episodeId, at });
	}
	return exercises;
}

/** What the child chose (an option's index) or wrote; null, not answered. */
export type Answer = number | string | null;

export interface Marks {
	/** Closed ones answered right, of all closed ones. */
	right: number;
	closed: number;
	/** Open ones answered, for an adult to read. */
	toRead: number;
	/** Not answered yet. */
	left: number;
}

/** The closed ones mark themselves; the open ones wait for an adult. */
export function mark(exercises: Exercise[], answers: Answer[]): Marks {
	const marks: Marks = { right: 0, closed: 0, toRead: 0, left: 0 };
	exercises.forEach((e, i) => {
		const given = answers[i] ?? null;
		if (e.kind === 'open') {
			if (typeof given === 'string' && given.trim()) marks.toRead++;
			else marks.left++;
			return;
		}
		marks.closed++;
		if (typeof given !== 'number') marks.left++;
		else if (given === e.answer) marks.right++;
	});
	return marks;
}

/** How a homework goes, chosen by the adult who prepares it. */
export interface HomeworkRules {
	/** Tries at each closed one; null, as many as needed. */
	tries: number | null;
	/** After a wrong try, its hint (if it has one). */
	hints: boolean;
	/** With no tries left, the right one is shown, so that it is learnt. */
	showAnswer: boolean;
}

export const TRIES_OPTIONS = [1, 2, 3, null] as const;

/** Until the adult changes them: a second chance with a hint, then the right one. */
export const DEFAULT_RULES: HomeworkRules = { tries: 2, hints: true, showAnswer: true };

/** Rules from a form or the database: what is not one of them, the default. */
export function checkRules(value: Partial<Record<keyof HomeworkRules, unknown>>): HomeworkRules {
	const tries = (TRIES_OPTIONS as readonly unknown[]).includes(value.tries)
		? (value.tries as number | null)
		: DEFAULT_RULES.tries;
	return {
		tries,
		hints: typeof value.hints === 'boolean' ? value.hints : DEFAULT_RULES.hints,
		showAnswer: typeof value.showAnswer === 'boolean' ? value.showAnswer : DEFAULT_RULES.showAnswer
	};
}

/** What the child sees after choosing, at a closed one. */
export type TryResult =
	| { result: 'right' }
	/** Wrong, and another try: with its hint, if the rules give it. */
	| { result: 'again'; hint: string | null }
	/** Wrong, and no tries left: the right one, if the rules show it. */
	| { result: 'wrong'; right: number | null };

/** The `tried`-th try (1, 2…) at a closed one, choosing `chosen`. */
export function tryAnswer(
	exercise: Exercise,
	chosen: number,
	tried: number,
	rules: HomeworkRules
): TryResult {
	if (chosen === exercise.answer) return { result: 'right' };
	if (rules.tries === null || tried < rules.tries)
		return { result: 'again', hint: rules.hints ? exercise.hint : null };
	return { result: 'wrong', right: rules.showAnswer ? exercise.answer : null };
}

/** Where the child is at each exercise: what they answered last, and in how many tries. */
export interface Step {
	answer: Answer;
	tries: number;
	/** Done with it: right, out of tries, or an open one written. */
	done: boolean;
}

/**
 * A homework's life: prepared (the adult reviews it, the child does not see it), given to the
 * child, and done.
 */
export type HomeworkStatus = 'draft' | 'assigned' | 'done';
