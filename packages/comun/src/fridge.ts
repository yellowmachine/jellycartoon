/**
 * The fridge (#131): the house's post-its, and the shopping list as one more. Shared by the server
 * and the pages: what they are, each person's paper, and the days one can be left up until.
 */
import type { AgendaToday } from 'comun/agenda.ts';

export interface FridgeAuthor {
	name: string;
	/** One of PAPERS, by who wrote it: the same person, the same colour, everywhere. */
	paper: number;
}

export interface FridgeNote {
	id: number;
	text: string;
	/** `YYYY-MM-DD`, its last day; null, until peeled off. */
	until: string | null;
	createdAt: string;
	author: FridgeAuthor | null;
}

export interface FridgeItem {
	id: number;
	text: string;
	done: boolean;
	author: FridgeAuthor | null;
}

/** All of it, as it is now: sent whole on every change (SSE). */
export interface FridgeState {
	notes: FridgeNote[];
	list: { id: number; items: FridgeItem[] };
	/** The agenda's «Hoy» (#200), only to look at. */
	today: AgendaToday;
}

/** The papers of the post-its, one per person: background, ink and the magnet's colour. */
export const PAPERS = [
	{ bg: '#fde68a', ink: '#422006', pin: '#dc2626' },
	{ bg: '#fbcfe8', ink: '#500724', pin: '#2563eb' },
	{ bg: '#bbf7d0', ink: '#052e16', pin: '#9333ea' },
	{ bg: '#bae6fd', ink: '#082f49', pin: '#ea580c' },
	{ bg: '#fed7aa', ink: '#431407', pin: '#16a34a' },
	{ bg: '#ddd6fe', ink: '#2e1065', pin: '#ca8a04' }
] as const;

/** The list's own: squared paper, white. */
export const LIST_PAPER = { bg: '#fafaf9', ink: '#1c1917', pin: '#dc2626' } as const;

/** A string's number, always the same: for each person's paper and each post-it's tilt. */
function hash(text: string) {
	let h = 0;
	for (const c of text) h = (h * 31 + c.codePointAt(0)!) | 0;
	return Math.abs(h);
}

export const paperFor = (userId: string) => hash(userId) % PAPERS.length;

/** Degrees it is stuck crooked, between −3 and 3, the same each time. */
export const tiltFor = (id: number) => ((hash(`nota${id}`) % 61) - 30) / 10;

export const MAX_NOTE = 280;
export const MAX_ITEM = 80;

/** `YYYY-MM-DD` of `date`, as it is in that place (not in UTC). */
const day = (date: Date) =>
	`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** The days a post-it can be left up until, as they are said. */
export const UNTIL_WORDS = ['hoy', 'mañana', 'viernes', 'domingo', 'semana'] as const;
export type UntilWord = (typeof UNTIL_WORDS)[number];
export const isUntilWord = (value: unknown): value is UntilWord =>
	UNTIL_WORDS.includes(value as UntilWord);

/** Its `YYYY-MM-DD` from `now`: Friday and Sunday, the next ones (not today). */
export function untilDay(word: UntilWord, now = new Date()) {
	const plus = (days: number) => {
		const d = new Date(now);
		d.setDate(d.getDate() + days);
		return day(d);
	};
	const next = (weekday: number) => plus((weekday - now.getDay() + 7) % 7 || 7);
	return {
		hoy: plus(0),
		mañana: plus(1),
		viernes: next(5),
		domingo: next(0),
		semana: plus(7)
	}[word];
}

const LABELS: Record<UntilWord, string> = {
	hoy: 'Hoy',
	mañana: 'Mañana',
	viernes: 'El viernes',
	domingo: 'El domingo',
	semana: 'Una semana'
};

/** The buttons to leave it up until, from `now`; a day that two would say, once. */
export function untilChoices(now = new Date()) {
	return UNTIL_WORDS.map((w) => ({ label: LABELS[w], value: untilDay(w, now) })).filter(
		(c, i, all) => all.findIndex((o) => o.value === c.value) === i
	);
}

/** «hasta hoy», «hasta mañana», «hasta el vie 25»: as it is said, from `now`. */
export function untilText(until: string, now = new Date()) {
	if (until === day(now)) return 'hasta hoy';
	const tomorrow = new Date(now);
	tomorrow.setDate(tomorrow.getDate() + 1);
	if (until === day(tomorrow)) return 'hasta mañana';
	const date = new Date(`${until}T12:00:00`);
	const weekday = new Intl.DateTimeFormat('es', { weekday: 'short' }).format(date).replace('.', '');
	return `hasta el ${weekday} ${date.getDate()}`;
}
