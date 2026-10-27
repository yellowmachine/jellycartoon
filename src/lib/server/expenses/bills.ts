import { desc, eq } from 'drizzle-orm';
import type { BillKind } from '#lib/bills.ts';
import { db } from '#lib/server/db/index.ts';
import { bill, expense } from '#lib/server/db/schema.ts';
import { billOf } from './expenses.ts';

/** The house's bills of one kind (#232), the latest first, with what was paid. */
export async function billsOf(kind: BillKind) {
	const rows = await db
		.select({
			id: expense.id,
			date: expense.date,
			store: expense.store,
			total: expense.total,
			bill
		})
		.from(bill)
		.innerJoin(expense, eq(expense.id, bill.expenseId))
		.where(eq(bill.kind, kind))
		.orderBy(desc(bill.periodEnd));
	return rows.map(({ bill, ...r }) => ({ ...r, ...billOf(bill) }));
}

/** The kinds the house has bills of. */
export async function billKinds() {
	const rows = await db.selectDistinct({ kind: bill.kind }).from(bill);
	return rows.map((r) => r.kind);
}
