import { desc, eq, sql } from 'drizzle-orm';
import type { BillKind } from 'comun/bills.ts';
import { bill, expense, expenseLine } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { billOf } from './expenses.ts';

/**
 * The family's bills of one kind (#232), the latest first, with what was paid and what its parts
 * add up to (null without parts): a bill that does not add up is to be checked.
 */
export async function billsOf(k: Kitchen, kind: BillKind) {
	const rows = await k.run((tx) =>
		tx
			.select({
				id: expense.id,
				date: expense.date,
				store: expense.store,
				total: expense.total,
				partsSum: sql<
					number | null
				>`(select sum(${expenseLine.amount})::int from ${expenseLine} where ${expenseLine.expenseId} = ${expense.id})`,
				bill
			})
			.from(bill)
			.innerJoin(expense, eq(expense.id, bill.expenseId))
			.where(eq(bill.kind, kind))
			.orderBy(desc(bill.periodEnd))
	);
	return rows.map(({ bill, ...r }) => ({ ...r, ...billOf(bill) }));
}

/** The kinds the family has bills of. */
export async function billKinds(k: Kitchen) {
	const rows = await k.run((tx) => tx.selectDistinct({ kind: bill.kind }).from(bill));
	return rows.map((r) => r.kind);
}
