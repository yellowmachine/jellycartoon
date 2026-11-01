import {
	and,
	asc,
	desc,
	eq,
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
	dueMonths,
	isCategory,
	isTag,
	lastDue,
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
						// Its own parentheses: Drizzle's exists() leaves them out around raw SQL.
						sql`exists (select 1 from ${expenseLine} where ${expenseLine.expenseId} = ${expense.id} and ${plain(expenseLine.text)} like ${plain(like)})`
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
				recurringId: expense.recurringId,
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
		return rows.map(({ receipt, category, bill, recurringId, ...r }) => ({
			...r,
			category: isCategory(category) ? category : 'Otros',
			hasReceipt: Boolean(receipt),
			fixed: recurringId !== null,
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
		tx
			.select()
			.from(recurringExpense)
			.orderBy(sql`${recurringExpense.month} nulls first`, asc(recurringExpense.day))
	);
	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		category: isCategory(r.category) ? r.category : 'Otros',
		amount: r.amount,
		day: r.day,
		month: r.month
	}));
}

/** The later of two `YYYY-MM`. */
const later = (a: string, b: string) => (a > b ? a : b);

/**
 * A new fixed one starts at its next day to come: the one already gone (this month's, this
 * year's) was likely already written down by hand.
 */
export async function addRecurring(k: Kitchen, r: Omit<RecurringExpense, 'id'>) {
	const lastMonth = lastDue(r, today());
	await k.run((tx) =>
		tx.insert(recurringExpense).values({ ...r, familyId: k.familyId, userId: k.userId, lastMonth })
	);
}

/** Changed to a day or month already gone, it is not added for it: from the next one. */
export async function updateRecurring(k: Kitchen, id: number, r: Omit<RecurringExpense, 'id'>) {
	await k.run(async (tx) => {
		const [row] = await tx
			.select({ lastMonth: recurringExpense.lastMonth })
			.from(recurringExpense)
			.where(eq(recurringExpense.id, id));
		if (!row) return;
		const due = lastDue(r, today());
		const lastMonth = row.lastMonth ? later(row.lastMonth, due) : due;
		await tx
			.update(recurringExpense)
			.set({ ...r, lastMonth })
			.where(eq(recurringExpense.id, id));
	});
}

/**
 * «🔁 Hacer fijo»: an expense already written down (Prime, by hand) made a fixed one, every month
 * or every year from its day (28 at most). It is the first: the next ones, from the next time on.
 * False if it is not there; already one, nothing new.
 */
export async function makeRecurring(k: Kitchen, expenseId: number, yearly: boolean) {
	return k.run(async (tx) => {
		const [e] = await tx
			.select({
				date: expense.date,
				store: expense.store,
				category: expense.category,
				total: expense.total,
				recurringId: expense.recurringId
			})
			.from(expense)
			.where(eq(expense.id, expenseId));
		if (!e) return false;
		if (e.recurringId !== null) return true;
		const r = {
			name: e.store.slice(0, 120),
			category: isCategory(e.category) ? e.category : 'Otros',
			amount: e.total,
			day: Math.min(28, Number(e.date.slice(8, 10))),
			month: yearly ? Number(e.date.slice(5, 7)) : null
		};
		const [row] = await tx
			.insert(recurringExpense)
			.values({
				...r,
				familyId: k.familyId,
				userId: k.userId,
				lastMonth: later(monthOf(e.date), lastDue(r, today()))
			})
			.returning({ id: recurringExpense.id });
		await tx.update(expense).set({ recurringId: row!.id }).where(eq(expense.id, expenseId));
		return true;
	});
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
	for (const r of await k.run((tx) => tx.select().from(recurringExpense))) {
		let previous = r.lastMonth;
		for (const month of dueMonths(r, r.lastMonth, now)) {
			// Claimed first: two pages opened at once add it once.
			const claimed = await k.run((tx) =>
				tx
					.update(recurringExpense)
					.set({ lastMonth: month })
					.where(
						and(
							eq(recurringExpense.id, r.id),
							previous === null
								? sql`${recurringExpense.lastMonth} is null`
								: eq(recurringExpense.lastMonth, previous)
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
			previous = month;
		}
	}
}
