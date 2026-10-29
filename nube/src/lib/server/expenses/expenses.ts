import {
	and,
	asc,
	desc,
	eq,
	exists,
	gte,
	inArray,
	lt,
	lte,
	or,
	sql,
	type SQL,
	type SQLWrapper
} from 'drizzle-orm';
import {
	bill,
	expense,
	expenseFavorite,
	expenseLine,
	recurringExpense,
	user
} from '#lib/server/db/schema.ts';
import type { AnyDb } from '#lib/server/family-scope.ts';
import { today, type Kitchen } from '#lib/server/fridge.ts';
import { isBillKind, isBillUnit, parseBillDetails, type BillInput } from 'comun/bills.ts';
import {
	addMonths,
	isCategory,
	isTag,
	monthOf,
	type Expense,
	type ExpenseFavorite,
	type ExpenseInput,
	type ExpenseSource,
	type RecurringExpense
} from 'comun/expenses.ts';
import { keepReceipt, removeReceipt } from './receipt.ts';

/**
 * The family's expenses (#253; jellycartoon's #194): every adult sees and changes all of them, as
 * the fridge's post-its. A month's, its totals by category, and the fixed ones added on their day.
 */

const firstDay = (month: string) => `${month}-01`;

export const monthExpenses = (k: Kitchen, month: string) =>
	expensesWhere(
		k,
		and(gte(expense.date, firstDay(month)), lt(expense.date, firstDay(addMonths(month, 1))))
	);

/** At most, in a search (Gastos → Búsqueda): the newest; no pages yet. */
export const SEARCH_LIMIT = 200;

/** Lowercase and without accents, in SQL: «Café» finds «cafe». No extension (unaccent) needed. */
const plain = (value: SQLWrapper | string) =>
	sql`translate(lower(${value}), 'áàäâéèëêíìïîóòöôúùüûñç', 'aaaaeeeeiiiioooouuuunc')`;

/**
 * Gastos → Búsqueda: those whose shop or any of whose lines has `text` (case and accents aside),
 * between two days (both included, either may be missing). The newest first, at most SEARCH_LIMIT.
 */
export function searchExpenses(
	k: Kitchen,
	{ text, from, to }: { text: string; from: string | null; to: string | null }
) {
	const like = `%${text.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
	return expensesWhere(
		k,
		and(
			text
				? or(
						sql`${plain(expense.store)} like ${plain(like)}`,
						exists(
							sql`select 1 from ${expenseLine} where ${expenseLine.expenseId} = ${expense.id} and ${plain(expenseLine.text)} like ${plain(like)}`
						)
					)
				: undefined,
			from ? gte(expense.date, from) : undefined,
			to ? lte(expense.date, to) : undefined
		),
		SEARCH_LIMIT
	);
}

/** The expenses `where` says, with their lines and bills: the newest first. */
function expensesWhere(k: Kitchen, where: SQL | undefined, limit?: number): Promise<Expense[]> {
	return k.run(async (tx) => {
		const query = tx
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
			.where(where)
			.orderBy(desc(expense.date), desc(expense.id))
			.$dynamic();
		const rows = await (limit ? query.limit(limit) : query);
		const lines = rows.length
			? await tx
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
	});
}

/** A month's total, without its expenses: the one before, to compare. */
export async function monthTotal(k: Kitchen, month: string) {
	const [row] = await k.run((tx) =>
		tx
			.select({ total: sql<number>`coalesce(sum(${expense.total}), 0)::int` })
			.from(expense)
			.where(
				and(gte(expense.date, firstDay(month)), lt(expense.date, firstDay(addMonths(month, 1))))
			)
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
async function writeBill(tx: AnyDb, familyId: string, expenseId: number, b: BillInput | null) {
	if (!b) return void (await tx.delete(bill).where(eq(bill.expenseId, expenseId)));
	await tx
		.insert(bill)
		.values({ familyId, expenseId, ...b })
		.onConflictDoUpdate({ target: bill.expenseId, set: b });
}

async function writeLines(tx: AnyDb, familyId: string, expenseId: number, input: ExpenseInput) {
	await tx.delete(expenseLine).where(eq(expenseLine.expenseId, expenseId));
	if (input.lines.length)
		await tx
			.insert(expenseLine)
			.values(input.lines.map((l, position) => ({ familyId, expenseId, position, ...l })));
}

/**
 * A new one, by `userId` (the kitchen's own by default: the person, or the house's voice); a receipt
 * or bill read (`tmp-…`), kept with it. Its id.
 */
export async function addExpense(
	k: Kitchen,
	input: ExpenseInput,
	source: ExpenseSource,
	receipt: string | null = null,
	recurringId: number | null = null,
	billInput: BillInput | null = null,
	userId: string | null = k.userId
) {
	const { lines: _, ...values } = input;
	const id = await k.run(async (tx) => {
		const [row] = await tx
			.insert(expense)
			.values({ ...values, familyId: k.familyId, source, userId, recurringId })
			.returning({ id: expense.id });
		await writeLines(tx, k.familyId, row!.id, input);
		if (billInput) await writeBill(tx, k.familyId, row!.id, billInput);
		return row!.id;
	});
	if (receipt) {
		const kept = await keepReceipt(k, receipt, id);
		if (kept)
			await k.run((tx) => tx.update(expense).set({ receipt: kept }).where(eq(expense.id, id)));
	}
	return id;
}

/** Corrected by any adult: its lines and its bill as they are now. False if it is gone. */
export function updateExpense(
	k: Kitchen,
	id: number,
	input: ExpenseInput,
	billInput: BillInput | null
) {
	const { lines: _, ...values } = input;
	return k.run(async (tx) => {
		const done = await tx
			.update(expense)
			.set(values)
			.where(eq(expense.id, id))
			.returning({ id: expense.id });
		if (!done.length) return false;
		await writeLines(tx, k.familyId, id, input);
		await writeBill(tx, k.familyId, id, billInput);
		return true;
	});
}

export async function deleteExpense(k: Kitchen, id: number) {
	const [gone] = await k.run((tx) =>
		tx.delete(expense).where(eq(expense.id, id)).returning({ receipt: expense.receipt })
	);
	await removeReceipt(k, gone?.receipt ?? null);
	return Boolean(gone);
}

/** Its receipt's file, to show it. */
export async function receiptOf(k: Kitchen, id: number) {
	const [row] = await k.run((tx) =>
		tx.select({ receipt: expense.receipt }).from(expense).where(eq(expense.id, id))
	);
	return row?.receipt ?? null;
}

/** The favourites, by name. */
export async function favoriteExpenses(k: Kitchen): Promise<ExpenseFavorite[]> {
	const rows = await k.run((tx) =>
		tx.select().from(expenseFavorite).orderBy(asc(expenseFavorite.store))
	);
	return rows.map((r) => ({
		id: r.id,
		store: r.store,
		category: isCategory(r.category) ? r.category : 'Otros',
		total: r.total,
		lines: r.lines
	}));
}

/** Marked as a favourite: one of the same name is replaced, not doubled. */
export async function saveFavorite(k: Kitchen, f: Omit<ExpenseFavorite, 'id'>) {
	await k.run(async (tx) => {
		const [same] = await tx
			.select({ id: expenseFavorite.id })
			.from(expenseFavorite)
			.where(sql`lower(${expenseFavorite.store}) = lower(${f.store})`);
		if (same) await tx.update(expenseFavorite).set(f).where(eq(expenseFavorite.id, same.id));
		else await tx.insert(expenseFavorite).values({ ...f, familyId: k.familyId, userId: k.userId });
	});
}

export async function deleteFavorite(k: Kitchen, id: number) {
	await k.run((tx) => tx.delete(expenseFavorite).where(eq(expenseFavorite.id, id)));
}

export async function recurringExpenses(k: Kitchen): Promise<RecurringExpense[]> {
	const rows = await k.run((tx) =>
		tx.select().from(recurringExpense).orderBy(asc(recurringExpense.day))
	);
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
export async function addRecurring(k: Kitchen, r: Omit<RecurringExpense, 'id'>) {
	const now = today();
	const lastMonth = Number(now.slice(8, 10)) >= r.day ? monthOf(now) : addMonths(monthOf(now), -1);
	await k.run((tx) =>
		tx.insert(recurringExpense).values({ ...r, familyId: k.familyId, userId: k.userId, lastMonth })
	);
}

export async function updateRecurring(k: Kitchen, id: number, r: Omit<RecurringExpense, 'id'>) {
	await k.run((tx) => tx.update(recurringExpense).set(r).where(eq(recurringExpense.id, id)));
}

/** The expenses it already added stay, as paid: let go of first, then it goes. */
export async function deleteRecurring(k: Kitchen, id: number) {
	await k.run(async (tx) => {
		await tx.update(expense).set({ recurringId: null }).where(eq(expense.recurringId, id));
		await tx.delete(recurringExpense).where(eq(recurringExpense.id, id));
	});
}

/**
 * The family's fixed ones whose day has come, added: each month once, also the ones missed while
 * nobody looked (from the month after the last one added). On opening Gastos, and by voice.
 */
export async function addDueRecurring(k: Kitchen, now = today()) {
	const thisMonth = monthOf(now);
	const day = Number(now.slice(8, 10));
	for (const r of await k.run((tx) => tx.select().from(recurringExpense))) {
		let month = r.lastMonth ? addMonths(r.lastMonth, 1) : thisMonth;
		while (month < thisMonth || (month === thisMonth && day >= r.day)) {
			// Claimed first: two pages opened at once add it once.
			const claimed = await k.run((tx) =>
				tx
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
					.returning({ id: recurringExpense.id })
			);
			if (!claimed.length) break;
			const date = `${month}-${String(r.day).padStart(2, '0')}`;
			await addExpense(
				k,
				{
					date,
					store: r.name,
					category: isCategory(r.category) ? r.category : 'Otros',
					total: r.amount,
					lines: []
				},
				'fijo',
				null,
				r.id,
				null,
				r.userId
			);
			r.lastMonth = month;
			month = addMonths(month, 1);
		}
	}
}
