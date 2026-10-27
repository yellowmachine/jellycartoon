import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { bill, expense, expenseLine, recurringExpense, user } from '#lib/server/db/schema.ts';
import { isBillKind, isBillUnit, parseBillDetails, type BillInput } from '#lib/bills.ts';
import {
	addMonths,
	isCategory,
	isTag,
	monthOf,
	type Expense,
	type ExpenseInput,
	type ExpenseSource,
	type RecurringExpense
} from '#lib/expenses.ts';
import { today } from '#lib/server/playlist.ts';
import { keepReceipt, removeReceipt } from './receipt.ts';

/**
 * The house's expenses (#194): every adult sees and changes all of them, as the fridge's
 * post-its. A month's, its totals by category, and the fixed ones added on their day.
 */

const firstDay = (month: string) => `${month}-01`;

export async function monthExpenses(month: string): Promise<Expense[]> {
	const rows = await db
		.select({
			id: expense.id,
			date: expense.date,
			store: expense.store,
			category: expense.category,
			total: expense.total,
			source: expense.source,
			receipt: expense.receipt,
			by: user.name,
			bill
		})
		.from(expense)
		.leftJoin(user, eq(user.id, expense.userId))
		.leftJoin(bill, eq(bill.expenseId, expense.id))
		.where(and(gte(expense.date, firstDay(month)), lt(expense.date, firstDay(addMonths(month, 1)))))
		.orderBy(desc(expense.date), desc(expense.id));
	const lines = rows.length
		? await db
				.select()
				.from(expenseLine)
				.where(
					inArray(
						expenseLine.expenseId,
						rows.map((r) => r.id)
					)
				)
				.orderBy(asc(expenseLine.position))
		: [];
	return rows.map(({ receipt, category, bill, ...r }) => ({
		...r,
		category: isCategory(category) ? category : 'Otros',
		hasReceipt: Boolean(receipt),
		bill: bill ? billOf(bill) : null,
		lines: lines
			.filter((l) => l.expenseId === r.id)
			.map((l) => ({
				text: l.text,
				quantity: l.quantity,
				amount: l.amount,
				tag: isTag(l.tag) ? l.tag : 'Otros'
			}))
	}));
}

/** A month's total, without its expenses: the one before, to compare. */
export async function monthTotal(month: string) {
	const [row] = await db
		.select({ total: sql<number>`coalesce(sum(${expense.total}), 0)::int` })
		.from(expense)
		.where(
			and(gte(expense.date, firstDay(month)), lt(expense.date, firstDay(addMonths(month, 1))))
		);
	return row?.total ?? 0;
}

/** A bill's row, as the pages have it. */
export function billOf(row: typeof bill.$inferSelect): BillInput {
	return {
		kind: isBillKind(row.kind) ? row.kind : 'Luz',
		periodStart: row.periodStart,
		periodEnd: row.periodEnd,
		consumption: row.consumption,
		unit: isBillUnit(row.unit) ? row.unit : 'kWh',
		details: parseBillDetails(row.details)
	};
}

/** Its bill as it is now; none, gone. */
async function writeBill(expenseId: number, b: BillInput | null) {
	if (!b) return void (await db.delete(bill).where(eq(bill.expenseId, expenseId)));
	await db
		.insert(bill)
		.values({ expenseId, ...b })
		.onConflictDoUpdate({ target: bill.expenseId, set: b });
}

async function writeLines(expenseId: number, input: ExpenseInput) {
	await db.delete(expenseLine).where(eq(expenseLine.expenseId, expenseId));
	if (input.lines.length)
		await db
			.insert(expenseLine)
			.values(input.lines.map((l, position) => ({ expenseId, position, ...l })));
}

/** A new one, by `userId`; a receipt or bill read (`tmp-…`), kept with it. Its id. */
export async function addExpense(
	userId: string | null,
	input: ExpenseInput,
	source: ExpenseSource,
	receipt: string | null = null,
	recurringId: number | null = null,
	billInput: BillInput | null = null
) {
	const { lines: _, ...values } = input;
	const [row] = await db
		.insert(expense)
		.values({ ...values, source, userId, recurringId })
		.returning({ id: expense.id });
	const id = row!.id;
	await writeLines(id, input);
	if (billInput) await writeBill(id, billInput);
	if (receipt) {
		const kept = await keepReceipt(receipt, id);
		if (kept) await db.update(expense).set({ receipt: kept }).where(eq(expense.id, id));
	}
	return id;
}

/** Corrected by any adult: its lines and its bill as they are now. False if it is gone. */
export async function updateExpense(id: number, input: ExpenseInput, billInput: BillInput | null) {
	const { lines: _, ...values } = input;
	const done = await db
		.update(expense)
		.set(values)
		.where(eq(expense.id, id))
		.returning({ id: expense.id });
	if (!done.length) return false;
	await writeLines(id, input);
	await writeBill(id, billInput);
	return true;
}

export async function deleteExpense(id: number) {
	const [gone] = await db
		.delete(expense)
		.where(eq(expense.id, id))
		.returning({ receipt: expense.receipt });
	await removeReceipt(gone?.receipt ?? null);
	return Boolean(gone);
}

/** Its receipt's file, to show it. */
export async function receiptOf(id: number) {
	const [row] = await db
		.select({ receipt: expense.receipt })
		.from(expense)
		.where(eq(expense.id, id));
	return row?.receipt ?? null;
}

export async function recurringExpenses(): Promise<RecurringExpense[]> {
	const rows = await db.select().from(recurringExpense).orderBy(asc(recurringExpense.day));
	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		category: isCategory(r.category) ? r.category : 'Otros',
		amount: r.amount,
		day: r.day
	}));
}

/**
 * A new fixed one starts this month if its day has not come yet, or the next if it has: the month
 * one is in was likely already written down by hand.
 */
export async function addRecurring(userId: string, r: Omit<RecurringExpense, 'id'>) {
	const now = today();
	const lastMonth = Number(now.slice(8, 10)) >= r.day ? monthOf(now) : addMonths(monthOf(now), -1);
	await db.insert(recurringExpense).values({ ...r, userId, lastMonth });
}

export async function updateRecurring(id: number, r: Omit<RecurringExpense, 'id'>) {
	await db.update(recurringExpense).set(r).where(eq(recurringExpense.id, id));
}

/** The expenses it already added stay, as paid. */
export async function deleteRecurring(id: number) {
	await db.delete(recurringExpense).where(eq(recurringExpense.id, id));
}

/**
 * The fixed ones whose day has come, added: each month once, also the ones missed while nobody
 * looked (from the month after the last one added). On opening Gastos, and by voice.
 */
export async function addDueRecurring(now = today()) {
	const thisMonth = monthOf(now);
	const day = Number(now.slice(8, 10));
	for (const r of await db.select().from(recurringExpense)) {
		let month = r.lastMonth ? addMonths(r.lastMonth, 1) : thisMonth;
		while (month < thisMonth || (month === thisMonth && day >= r.day)) {
			// Claimed first: two pages opened at once add it once.
			const claimed = await db
				.update(recurringExpense)
				.set({ lastMonth: month })
				.where(
					and(
						eq(recurringExpense.id, r.id),
						r.lastMonth === null
							? sql`${recurringExpense.lastMonth} is null`
							: eq(recurringExpense.lastMonth, addMonths(month, -1))
					)
				)
				.returning({ id: recurringExpense.id });
			if (!claimed.length) break;
			const date = `${month}-${String(r.day).padStart(2, '0')}`;
			await addExpense(
				r.userId,
				{
					date,
					store: r.name,
					category: isCategory(r.category) ? r.category : 'Otros',
					total: r.amount,
					lines: []
				},
				'fijo',
				null,
				r.id
			);
			r.lastMonth = month;
			month = addMonths(month, 1);
		}
	}
}
