import { and, eq, gte, isNotNull, isNull, lt } from 'drizzle-orm';
import { expense } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import {
	addMonths,
	isCategory,
	monthOf,
	type ExpenseDraft,
	type FixedMatch
} from 'comun/expenses.ts';
import { plainText } from './plain.ts';
import { keepReceipt, removeReceipt } from './receipt.ts';

/**
 * The month's receipt or bill of a fixed one (#501): attached to the expense it added, not put in
 * as another (that would count twice). From «📎 Recibo» on it, or said yes to when the bill read
 * looks like its.
 */

/**
 * Its file now this one (a receipt it had, replaced and removed). False if the expense is gone.
 * Throws NotADocument if that is not a PDF or a picture.
 */
export async function attachReceipt(
	k: Kitchen,
	id: number,
	file: Uint8Array,
	/** As chosen (#440): to see it put in again. */
	fileHash: string | null = null
) {
	const kept = await keepReceipt(k, file);
	let old: { receipt: string | null } | undefined;
	try {
		old = await k.run(async (tx) => {
			const [row] = await tx
				.select({ receipt: expense.receipt })
				.from(expense)
				.where(eq(expense.id, id))
				.for('update');
			if (row) await tx.update(expense).set({ receipt: kept, fileHash }).where(eq(expense.id, id));
			return row;
		});
	} catch (err) {
		await removeReceipt(k, kept);
		throw err;
	}
	if (!old) {
		await removeReceipt(k, kept);
		return false;
	}
	if (old.receipt && old.receipt !== kept) await removeReceipt(k, old.receipt);
	return true;
}

/** «Quitar el recibo»: its file gone, what it says (the amount, the bill) stays. */
export async function dropReceipt(k: Kitchen, id: number) {
	const [old] = await k.run((tx) =>
		tx
			.select({ receipt: expense.receipt })
			.from(expense)
			.where(and(eq(expense.id, id), isNotNull(expense.receipt)))
	);
	if (!old) return false;
	await k.run((tx) =>
		tx.update(expense).set({ receipt: null, fileHash: null }).where(eq(expense.id, id))
	);
	await removeReceipt(k, old.receipt);
	return true;
}

/** Near enough to be the same amount by itself: 5 % or a euro. */
const nearAmount = (a: number, b: number) =>
	a > 0 && Math.abs(a - b) <= Math.max(100, Math.round(b * 0.05));

/** «Luz» in «Luz Iberdrola», «Iberdrola» in «Luz (Iberdrola)», or the bill's supply in the name. */
function sameName(fixedName: string, draft: Pick<ExpenseDraft, 'store' | 'bill'>) {
	const name = plainText(fixedName).trim();
	const store = plainText(draft.store).trim();
	if (!name) return false;
	if (store && (store.includes(name) || name.includes(store))) return true;
	if (!draft.bill) return false;
	const kind = plainText(draft.bill.kind);
	return name.split(/[^\p{L}\p{N}]+/u).includes(kind);
}

/**
 * Of those fixed ones' expenses, the one the receipt or bill read is likely of: by its name (the
 * shop, or the bill's supply), else by an amount near enough; of its own month before the one
 * before; then the nearest amount. Null, none.
 */
export function bestFixed(
	draft: Pick<ExpenseDraft, 'date' | 'store' | 'total' | 'bill'>,
	candidates: FixedMatch[]
): FixedMatch | null {
	const month = monthOf(draft.date);
	const scored = candidates
		.map((c) => ({ c, named: sameName(c.store, draft) }))
		.filter(({ c, named }) => named || nearAmount(draft.total, c.total))
		.sort(
			(a, b) =>
				Number(b.named) - Number(a.named) ||
				Number(monthOf(b.c.date) === month) - Number(monthOf(a.c.date) === month) ||
				Math.abs(a.c.total - draft.total) - Math.abs(b.c.total - draft.total)
		);
	return scored[0]?.c ?? null;
}

/**
 * The fixed one's expense a receipt or bill just read may be of (#501): of its month or the one
 * before, without a receipt yet. Null, none.
 */
export async function fixedMatchOf(
	k: Kitchen,
	draft: Pick<ExpenseDraft, 'date' | 'store' | 'total' | 'bill'>
): Promise<FixedMatch | null> {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) return null;
	const month = monthOf(draft.date);
	const rows = await k.run((tx) =>
		tx
			.select({
				id: expense.id,
				date: expense.date,
				store: expense.store,
				category: expense.category,
				total: expense.total
			})
			.from(expense)
			.where(
				and(
					isNotNull(expense.recurringId),
					isNull(expense.receipt),
					gte(expense.date, `${addMonths(month, -1)}-01`),
					lt(expense.date, `${addMonths(month, 1)}-01`)
				)
			)
	);
	return bestFixed(
		draft,
		rows.map((r) => ({ ...r, category: isCategory(r.category) ? r.category : 'Otros' }))
	);
}
