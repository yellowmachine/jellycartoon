import { addDays, mondayOf } from 'comun/agenda.ts';
import {
	addMonths,
	EXPENSE_CATEGORIES,
	monthOf,
	type Expense,
	type ExpenseCategory
} from 'comun/expenses.ts';

/**
 * Resumen: what there was in the last 7 days, always up to date, or in a week or a month already
 * over, beside the ones before. By rules, without the AI: figures, not advice.
 */

export const SUMMARY_VIEWS = {
	dias: 'Últimos 7 días',
	semana: 'Semanas',
	mes: 'Meses'
} as const;
export type SummaryView = keyof typeof SUMMARY_VIEWS;
export const isSummaryView = (v: unknown): v is SummaryView =>
	typeof v === 'string' && Object.hasOwn(SUMMARY_VIEWS, v);

export interface SummaryPeriod {
	view: SummaryView;
	/** Its days, both included, and those of the one it is compared with. */
	from: string;
	to: string;
	prevFrom: string;
	prevTo: string;
	/** The first day of the one before and after it, to go there; null, there is none. */
	before: string | null;
	after: string | null;
	/** What is to come, told with the newest only: its last day. */
	until: string | null;
}

const monthEnd = (month: string) => addDays(`${addMonths(month, 1)}-01`, -1);

/** Of that view, the one `de` falls in; by default, or not over yet, the last one over. */
export function summaryPeriod(view: SummaryView, de: string | null, today: string): SummaryPeriod {
	if (view === 'dias') {
		const from = addDays(today, -6);
		return {
			view,
			from,
			to: today,
			prevFrom: addDays(from, -7),
			prevTo: addDays(from, -1),
			before: null,
			after: null,
			until: addDays(today, 7)
		};
	}
	if (view === 'semana') {
		const last = addDays(mondayOf(today), -7);
		const asked = de ? mondayOf(de) : last;
		const from = asked > last ? last : asked;
		return {
			view,
			from,
			to: addDays(from, 6),
			prevFrom: addDays(from, -7),
			prevTo: addDays(from, -1),
			before: addDays(from, -7),
			after: from < last ? addDays(from, 7) : null,
			until: from === last ? addDays(mondayOf(today), 6) : null
		};
	}
	const last = addMonths(monthOf(today), -1);
	const asked = de ? monthOf(de) : last;
	const month = asked > last ? last : asked;
	const prev = addMonths(month, -1);
	return {
		view,
		from: `${month}-01`,
		to: monthEnd(month),
		prevFrom: `${prev}-01`,
		prevTo: monthEnd(prev),
		before: `${prev}-01`,
		after: month < last ? `${addMonths(month, 1)}-01` : null,
		until: month === last ? monthEnd(monthOf(today)) : null
	};
}

export interface Money {
	/** Without the fixed ones. */
	total: number;
	count: number;
	/** The one before; null, nothing in it to compare with. */
	before: number | null;
	fixed: number;
	categories: { category: ExpenseCategory; total: number; before: number }[];
	/** The ones that changed most, at least by CHANGED. */
	up: { category: ExpenseCategory; by: number }[];
	down: { category: ExpenseCategory; by: number }[];
	largest: { id: number; date: string; store: string; total: number }[];
}
/** Cents: less, it is not told as a change. */
const CHANGED = 1000;
const LARGEST = 3;
const MOST_CHANGES = 2;

export function moneyOf(now: Expense[], before: Expense[]): Money | null {
	if (!now.length && !before.length) return null;
	// One added by a fixed one taken away since, too.
	const isFixed = (e: Expense) => e.fixed || e.source === 'fijo';
	const loose = (list: Expense[]) => list.filter((e) => !isFixed(e));
	const sum = (list: Expense[]) => list.reduce((s, e) => s + e.total, 0);
	const [mine, theirs] = [loose(now), loose(before)];
	const categories = EXPENSE_CATEGORIES.map((category) => {
		const of = (list: Expense[]) => sum(list.filter((e) => e.category === category));
		return { category, total: of(mine), before: of(theirs) };
	});
	const changes = theirs.length
		? categories
				.map((c) => ({ category: c.category, by: c.total - c.before }))
				.sort((a, b) => b.by - a.by)
		: [];
	return {
		total: sum(mine),
		count: mine.length,
		before: theirs.length ? sum(theirs) : null,
		fixed: sum(now.filter(isFixed)),
		categories: categories.filter((c) => c.total > 0).sort((a, b) => b.total - a.total),
		up: changes.filter((c) => c.by >= CHANGED).slice(0, MOST_CHANGES),
		down: changes
			.filter((c) => c.by <= -CHANGED)
			.reverse()
			.slice(0, MOST_CHANGES),
		largest: [...mine]
			.sort((a, b) => b.total - a.total)
			.slice(0, LARGEST)
			.map(({ id, date, store, total }) => ({ id, date, store, total }))
	};
}

/**
 * «−18 %», «+3 %», «igual»; null, when a percentage would say nothing: no one before, or so small
 * (`least`) that any change is a large one.
 */
export function changeText(now: number, before: number | null, least: number) {
	if (before === null || before < least) return null;
	const by = Math.round(((now - before) / before) * 100);
	if (by === 0) return 'igual';
	return `${by > 0 ? '+' : '−'}${Math.abs(by)} %`;
}
