import { FUEL_KINDS, wholeUnits, type FuelKind, type UnitDays } from './fuel.ts';

/**
 * What butane and pellet cost (#628, step 2): each purchase, from its expense in Dinero or as the
 * family wrote it; each unit, its part of the purchase it came from, and by the day, what it lasted.
 */

const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export interface PaidExpense {
	store: string;
	total: number;
	lines: { text: string; amount: number }[];
}

/**
 * Of an expense, what was for it, in cents: the lines that say it (a sack among the rest of the
 * shopping); with none, all of it if the shop says it or there are no lines to tell apart. Null, not known.
 */
export function costIn(e: PaidExpense, kind: FuelKind): number | null {
	const says = (text: string) => FUEL_KINDS[kind].words.some((w) => plain(text).includes(w));
	const lines = e.lines.filter((l) => says(l.text));
	if (lines.length) return lines.reduce((s, l) => s + l.amount, 0);
	return says(e.store) || !e.lines.length ? e.total : null;
}

/** A unit that ended, all used, with what it cost if it is known (cents, not whole ones). */
export interface CostedUnit extends UnitDays {
	cost: number | null;
}

const daysOf = (u: { startedOn: string; endedOn: string | null }) =>
	u.endedOn ? Math.round((Date.parse(u.endedOn) - Date.parse(u.startedOn)) / 86_400_000) : 0;

/** Cents a day of one; null, not known (going, taken away half full, no price, the same day). */
export function perDay(u: CostedUnit): number | null {
	const n = daysOf(u);
	return u.whole && u.cost !== null && n > 0 ? u.cost / n : null;
}

export interface FuelSums {
	/** Units ended and all used, and what they lasted on average, in days. */
	units: number;
	days: number;
	/** Cents a day, of those whose price is known; null, none. */
	perDay: number | null;
	/** How many of them had a price. */
	priced: number;
}

/** What a spot's units add up to; null, none ended yet. */
export function fuelSums(units: CostedUnit[]): FuelSums | null {
	const whole = wholeUnits(units) as CostedUnit[];
	if (!whole.length) return null;
	const priced = whole.filter((u) => u.cost !== null);
	const total = (list: CostedUnit[]) => list.reduce((s, u) => s + daysOf(u), 0);
	return {
		units: whole.length,
		days: total(whole) / whole.length,
		perDay: priced.length ? priced.reduce((s, u) => s + u.cost!, 0) / total(priced) : null,
		priced: priced.length
	};
}
