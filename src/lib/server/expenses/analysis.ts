import { and, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { expense, expenseLine } from '#lib/server/db/schema.ts';
import { addMonths } from '#lib/expenses.ts';
import { analyse, type MonthSum } from './analysis-sums.ts';

/** The shops in the period, at most: the ones that matter. */
const STORES = 15;

const monthOfDate = sql<string>`to_char(${expense.date}, 'YYYY-MM')`;

/**
 * Gastos → Análisis (#194): the sums by month, category, tag and shop made by the database, so it
 * stays quick with years of receipts; what they say, in analysis-sums.ts. `period`, the months
 * the categories and shops cover, this one in; without `withFixed`, only what varies.
 */
export async function expenseAnalysis(current: string, period: number, withFixed: boolean) {
	const since = `${addMonths(current, -11)}-01`;
	const periodSince = `${addMonths(current, -(period - 1))}-01`;
	const varying = withFixed ? undefined : ne(expense.source, 'fijo');
	const total = sql<number>`sum(${expense.total})::int`;

	const [byCategory, byTag, stores, [first]] = await Promise.all([
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
		// Shops: receipts and written by hand, not the fixed ones' or voice's names.
		db
			.select({ store: expense.store, total, visits: sql<number>`count(*)::int` })
			.from(expense)
			.where(and(gte(expense.date, periodSince), inArray(expense.source, ['ticket', 'mano'])))
			.groupBy(expense.store)
			.orderBy(desc(total))
			.limit(STORES),
		db
			.select({ first: sql<string | null>`to_char(min(${expense.date}), 'YYYY-MM')` })
			.from(expense)
			.where(varying)
	]);

	return {
		...analyse(byCategory as MonthSum[], byTag as MonthSum[], {
			current,
			period,
			first: first?.first ?? null
		}),
		stores
	};
}
