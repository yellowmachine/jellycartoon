import { plainText } from './plain.ts';

/**
 * Which of the expenses put in one by one (two books bought from Deseos) a bill or a bank's payment
 * gathers. By rules, without the AI; with any doubt, none.
 */

export interface Part {
	id: number;
	date: string;
	store: string;
	total: number;
	/** What it was: its lines, its wish. */
	titles: string[];
}

export interface Whole {
	store: string;
	total: number;
	lines: { text: string; amount: number }[];
}

/** Days before or after it. */
export const MERGE_DAYS = 10;
/** Those offered to choose by hand: a book may take a month to come. */
export const CHOOSE_DAYS = 45;
const MOST_PARTS = 5;
/** Of one shop, tried together at most. */
const MOST_TRIED = 12;
/** Cents apart, for several; one alone, exactly. */
const CENTS = 10;

/** «IberLibro» and «Iberlibro.com»: one in the other. */
function sameStore(a: string, b: string) {
	const [x, y] = [a, b].map((s) => plainText(s).replace(/[^\p{L}\p{N}]+/gu, ''));
	return Math.min(x!.length, y!.length) >= 3 && (x!.includes(y!) || y!.includes(x!));
}

const words = (text: string) =>
	plainText(text)
		.split(/[^\p{L}\p{N}]+/u)
		.filter((w) => w.length >= 4);

/** Most of the title's first words in the line: at least two, or its only one. */
function titleIn(title: string, line: string) {
	const said = [...new Set(words(title))].slice(0, 6);
	if (!said.length) return false;
	const there = new Set(words(line));
	const found = said.filter((w) => there.has(w)).length;
	return found >= Math.min(2, said.length) && found / said.length >= 0.6;
}

const sum = (parts: Part[]) => parts.reduce((s, p) => s + p.total, 0);

/** Those said in its lines, each in its own (its price, its sending, its VAT); null with a doubt: two in one line. */
function byTitle(whole: Whole, parts: Part[]) {
	const lines = whole.lines.filter((l) => l.amount > 0);
	const used = new Set<number>();
	const found: Part[] = [];
	for (const p of parts) {
		const at = lines.flatMap((l, i) => (p.titles.some((t) => titleIn(t, l.text)) ? [i] : []));
		if (!at.length) continue;
		if (at.some((i) => used.has(i))) return null;
		for (const i of at) used.add(i);
		found.push(p);
	}
	if (!found.length || found.length > MOST_PARTS) return null;
	// Its sending or taxes may be on the bill alone; a book of an order of ten is not all of it.
	return Math.abs(sum(found) - whole.total) <= Math.max(100, whole.total * 0.15) ? found : null;
}

/** The only ones of that shop that add up to it; null, none or several ways. */
function bySum(whole: Whole, parts: Part[]) {
	const same = parts.filter((p) => sameStore(p.store, whole.store)).slice(0, MOST_TRIED);
	const ways: Part[][] = [];
	const add = (from: number, chosen: Part[], total: number) => {
		if (ways.length > 1) return;
		const apart = Math.abs(total - whole.total);
		if (chosen.length && apart <= (chosen.length === 1 ? 0 : CENTS)) ways.push(chosen);
		if (chosen.length === MOST_PARTS) return;
		for (let i = from; i < same.length; i++)
			add(i + 1, [...chosen, same[i]!], total + same[i]!.total);
	};
	add(0, [], 0);
	return ways.length === 1 ? ways[0]! : null;
}

/** Those it gathers, or null. */
export function partsOf(whole: Whole, parts: Part[]): Part[] | null {
	if (whole.total <= 0) return null;
	return byTitle(whole, parts) ?? bySum(whole, parts);
}
