import {
	EXPENSE_CATEGORIES,
	UNTAGGED,
	addMonths,
	isCategory,
	type ExpenseCategory
} from '#lib/expenses.ts';

/**
 * Gastos → Análisis (#194), from the sums the database makes: the last 12 months, what is above
 * its usual this month, the period's categories with their tags. Apart from the queries, to test.
 */

/** A month's sum for a category, or for one of its tags. */
export interface MonthSum {
	month: string;
	category: string;
	tag?: string;
	total: number;
}

/** Above its usual: at least this much more, and this many cents. */
const ABOVE_RATIO = 1.2;
const ABOVE_CENTS = 1000;
/** The months before this one that make «the usual». */
const USUAL_MONTHS = 3;

export interface Above {
	category: ExpenseCategory;
	/** A tag of the category; none, the whole category. */
	tag: string | null;
	now: number;
	usual: number;
}

export interface CategoryPeriod {
	category: ExpenseCategory;
	total: number;
	perMonth: number;
	/** By tag, only when its lines are of more than one; what they miss, last. */
	tags: { tag: string; total: number }[];
}

export interface Analysis {
	/** The last 12 months, oldest first; this one is not over yet. */
	months: { month: string; total: number }[];
	/** A full month's average, since the first one written down; null without one. */
	average: number | null;
	/** What this month already passes its usual by; null if there is no month before to compare. */
	above: Above[] | null;
	categories: CategoryPeriod[];
	/** The months the period's averages count: from the first one written down. */
	periodMonths: number;
}

const category = (c: string): ExpenseCategory => (isCategory(c) ? c : 'Otros');

/** Months from `from` to `to`, both in. */
function monthsBetween(from: string, to: string) {
	const out: string[] = [];
	for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
	return out;
}

/**
 * `byCategory` and `byTag` (lines' sums), month by month for the last 12 months; `first`, the
 * month of the first expense ever written down, or null if none.
 */
export function analyse(
	byCategory: MonthSum[],
	byTag: MonthSum[],
	{ current, period, first }: { current: string; period: number; first: string | null }
): Analysis {
	const year = monthsBetween(addMonths(current, -11), current);
	const months = year.map((month) => ({
		month,
		total: byCategory.filter((r) => r.month === month).reduce((s, r) => s + r.total, 0)
	}));

	const full = first ? year.filter((m) => m >= first && m < current) : [];
	const average = full.length
		? Math.round(
				months.filter((m) => full.includes(m.month)).reduce((s, m) => s + m.total, 0) / full.length
			)
		: null;

	const usualMonths = full.slice(-USUAL_MONTHS);
	const sum = (rows: MonthSum[], months: string[], c: string, tag: string | null) =>
		rows
			.filter(
				(r) => months.includes(r.month) && category(r.category) === c && (r.tag ?? null) === tag
			)
			.reduce((s, r) => s + r.total, 0);
	let above: Above[] | null = null;
	if (usualMonths.length) {
		const keys = new Map<
			string,
			{ category: ExpenseCategory; tag: string | null; rows: MonthSum[] }
		>();
		for (const r of byCategory)
			keys.set(category(r.category), {
				category: category(r.category),
				tag: null,
				rows: byCategory
			});
		for (const r of byTag)
			keys.set(`${category(r.category)}\n${r.tag}`, {
				category: category(r.category),
				tag: r.tag!,
				rows: byTag
			});
		above = [...keys.values()]
			.map(({ category: c, tag, rows }) => ({
				category: c,
				tag,
				now: sum(rows, [current], c, tag),
				usual: Math.round(sum(rows, usualMonths, c, tag) / usualMonths.length)
			}))
			// A tag never seen before is the receipts being read with tags (since 2026-10-26), not
			// more spent; a new category is.
			.filter((a) => a.tag === null || a.usual > 0)
			.filter((a) => a.now >= a.usual * ABOVE_RATIO && a.now - a.usual >= ABOVE_CENTS)
			.sort((a, b) => b.now - b.usual - (a.now - a.usual));
	}

	const periodMonths = year.slice(-period).filter((m) => !first || m >= first);
	const counted = Math.max(periodMonths.length, 1);
	const categories = EXPENSE_CATEGORIES.map((c) => {
		const total = sum(byCategory, periodMonths, c, null);
		const tagTotals = new Map<string, number>();
		for (const r of byTag)
			if (periodMonths.includes(r.month) && category(r.category) === c)
				tagTotals.set(r.tag!, (tagTotals.get(r.tag!) ?? 0) + r.total);
		const tagged = [...tagTotals.values()].reduce((s, t) => s + t, 0);
		const tags = [...tagTotals]
			.map(([tag, total]) => ({ tag, total }))
			.sort((a, b) => b.total - a.total);
		if (total - tagged) tags.push({ tag: UNTAGGED, total: total - tagged });
		return {
			category: c,
			total,
			perMonth: Math.round(total / counted),
			tags: tags.filter((t) => t.total !== 0).length > 1 ? tags.filter((t) => t.total !== 0) : []
		};
	})
		.filter((c) => c.total > 0)
		.sort((a, b) => b.total - a.total);

	return { months, average, above, categories, periodMonths: counted };
}
