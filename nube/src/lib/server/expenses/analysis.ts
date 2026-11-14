import { and, desc, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { expense, expenseLine } from '#lib/server/db/schema.ts';
import { addMonths } from 'comun/expenses.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { analyse, type MonthSum } from './analysis-sums.ts';

/** The shops in the period, at most: the ones that matter. */
const STORES = 15;

const monthOfDate = sql<string>`to_char(${expense.date}, 'YYYY-MM')`;

/**
 * Gastos → Análisis (#194): the sums by month, category, tag and shop made by the database, so it
 * stays quick with years of receipts; what they say, in analysis-sums.ts. `period`, the months
 * the categories and shops cover, this one in; without `withFixed`, only what varies.
 */
export async function expenseAnalysis(
	k: Kitchen,
	current: string,
	period: number,
	withFixed: boolean
) {
	const since = `${addMonths(current, -11)}-01`;
	const periodSince = `${addMonths(current, -(period - 1))}-01`;
	// Also the one made fixed («🔁 Hacer fijo»): it was written down by hand.
	const varying = withFixed
		? undefined
		: and(ne(expense.source, 'fijo'), isNull(expense.recurringId));
	const total = sql<number>`sum(${expense.total})::int`;

	// One transaction, one after the other: the family's, as row-level security asks.
	const [byCategory, byTag, stores, [first]] = await k.run((db) =>
		Promise.all([
			db
				.select({ month: monthOfDate, category: expense.category, total })
				.from(expense)
				.where(and(gte(expense.date, since), varying))
				.groupBy(monthOfDate, expense.category),
			db
				.select({
					month: monthOfDate,
					category: expense.category,
					tag: expenseLine.tag,
					total: sql<number>`sum(${expenseLine.amount})::int`
				})
				.from(expenseLine)
				.innerJoin(expense, eq(expense.id, expenseLine.expenseId))
				.where(and(gte(expense.date, since), varying))
				.groupBy(monthOfDate, expense.category, expenseLine.tag),
			// Shops: receipts, written by hand and the bank's (#502), not the fixed ones' or voice's names.
			db
				.select({ store: expense.store, total, visits: sql<number>`count(*)::int` })
				.from(expense)
				.where(
					and(gte(expense.date, periodSince), inArray(expense.source, ['ticket', 'mano', 'banco']))
				)
				.groupBy(expense.store)
				.orderBy(desc(total))
				.limit(STORES),
			db
				.select({ first: sql<string | null>`to_char(min(${expense.date}), 'YYYY-MM')` })
				.from(expense)
				.where(varying)
		])
	);

	return {
		...analyse(byCategory as MonthSum[], byTag as MonthSum[], {
			current,
			period,
			first: first?.first ?? null
		}),
		stores
	};
}

/**
 * What was spent by month and category between two months (both in), the fixed ones too: for
 * «Preguntar» (#504), which crosses it with the rest. Only sums, as Análisis.
 */
export function expenseSums(k: Kitchen, from: string, to: string) {
	return k.run((db) =>
		db
			.select({
				month: monthOfDate,
				category: expense.category,
				total: sql<number>`sum(${expense.total})::int`,
				count: sql<number>`count(*)::int`
			})
			.from(expense)
			.where(and(gte(expense.date, `${from}-01`), lt(expense.date, `${addMonths(to, 1)}-01`)))
			.groupBy(monthOfDate, expense.category)
			.orderBy(monthOfDate, expense.category)
	);
}
