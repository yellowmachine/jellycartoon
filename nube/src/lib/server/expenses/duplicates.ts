import { and, asc, eq, gte, inArray, lt, or, type SQL } from 'drizzle-orm';
import { bill, expense, expenseNotDuplicate } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { noticeOn } from '#lib/server/page-notices.ts';
import { addMonths, type ExpenseSource } from 'comun/expenses.ts';
import type { LooksSame, SameBy } from 'comun/page-notices.ts';

/**
 * A receipt or a bill put in twice (#440, phase 1), by rules: the same file; a bill of the same
 * supply and period; or the same day and total, one of them a receipt or a bill (two coffees by
 * hand the same day are not). Said when it is read and when it is saved, and in the month's page,
 * on the newer of the two; not again once «No es repetido».
 */

/** An expense as the rule sees it: a new one has no id yet. */
export interface Compared {
	id: number | null;
	date: string;
	store: string;
	total: number;
	source: ExpenseSource;
	fileHash: string | null;
	bill: { kind: string; periodStart: string; periodEnd: string } | null;
}

const WITH_DOCUMENT: ExpenseSource[] = ['ticket', 'factura'];

/** SHA-256, as the browser sends it. */
export const isFileHash = (v: unknown): v is string =>
	typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

/** Why `a` looks the same as `b`; null, it does not. */
export function sameBy(a: Compared, b: Compared): SameBy | null {
	if (a.id !== null && a.id === b.id) return null;
	if (a.fileHash && a.fileHash === b.fileHash) return 'fichero';
	// Two bills, by their period: what a bill put in twice always has the same.
	if (a.bill && b.bill)
		return a.bill.kind === b.bill.kind &&
			a.bill.periodStart === b.bill.periodStart &&
			a.bill.periodEnd === b.bill.periodEnd
			? 'periodo'
			: null;
	if (a.date !== b.date || a.total !== b.total) return null;
	return WITH_DOCUMENT.includes(a.source) || WITH_DOCUMENT.includes(b.source) ? 'dia' : null;
}

const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

const looksSame = (c: Compared & { id: number }, by: SameBy): LooksSame => ({
	id: c.id,
	date: c.date,
	store: c.store,
	total: c.total,
	by
});

function comparedWhere(k: Kitchen, where: SQL | undefined): Promise<(Compared & { id: number })[]> {
	return k.run(async (tx) => {
		const rows = await tx
			.select({
				id: expense.id,
				date: expense.date,
				store: expense.store,
				total: expense.total,
				source: expense.source,
				fileHash: expense.fileHash,
				kind: bill.kind,
				periodStart: bill.periodStart,
				periodEnd: bill.periodEnd
			})
			.from(expense)
			.leftJoin(bill, eq(bill.expenseId, expense.id))
			.where(where)
			.orderBy(asc(expense.date), asc(expense.id));
		return rows.map(({ kind, periodStart, periodEnd, ...r }) => ({
			...r,
			bill: kind && periodStart && periodEnd ? { kind, periodStart, periodEnd } : null
		}));
	});
}

/** The family's expenses that could look the same as any of `cs`: by file, day or period. */
function candidates(k: Kitchen, cs: Compared[]) {
	const hashes = [...new Set(cs.flatMap((c) => (c.fileHash ? [c.fileHash] : [])))];
	const days = [...new Set(cs.map((c) => c.date))];
	const bills = cs.flatMap((c) => (c.bill ? [c.bill] : []));
	const any = [
		hashes.length ? inArray(expense.fileHash, hashes) : undefined,
		days.length ? inArray(expense.date, days) : undefined,
		...bills.map((b) =>
			and(
				eq(bill.kind, b.kind),
				eq(bill.periodStart, b.periodStart),
				eq(bill.periodEnd, b.periodEnd)
			)
		)
	].filter(Boolean);
	return any.length ? comparedWhere(k, or(...any)) : Promise.resolve([]);
}

/** The pairs among `ids` said not to be the same. */
async function notSame(k: Kitchen, ids: number[]) {
	if (!ids.length) return new Set<string>();
	const rows = await k.run((tx) =>
		tx
			.select()
			.from(expenseNotDuplicate)
			.where(or(inArray(expenseNotDuplicate.a, ids), inArray(expenseNotDuplicate.b, ids)))
	);
	return new Set(rows.map((r) => pairKey(r.a, r.b)));
}

/** One about to be put in: the one it looks the same as, if any; nothing with the notice off. */
export async function lookingSame(k: Kitchen, c: Compared): Promise<LooksSame | null> {
	if (!(await noticeOn(k, 'repetido'))) return null;
	for (const other of await candidates(k, [c])) {
		const by = sameBy(c, other);
		if (by) return looksSame(other, by);
	}
	return null;
}

/**
 * A month's (`YYYY-MM`) put in twice: each newer one, by its id, with the older one it looks the
 * same as (which may be of another month). Nothing with the notice off.
 */
export async function monthRepeated(k: Kitchen, month: string): Promise<Record<number, LooksSame>> {
	if (!(await noticeOn(k, 'repetido'))) return {};
	const month1 = `${month}-01`;
	const shown = await comparedWhere(
		k,
		and(gte(expense.date, month1), lt(expense.date, `${addMonths(month, 1)}-01`))
	);
	if (!shown.length) return {};
	const others = await candidates(k, shown);
	const dismissed = await notSame(
		k,
		shown.map((s) => s.id)
	);
	const found: Record<number, LooksSame> = {};
	for (const s of shown)
		for (const o of others) {
			if (o.id >= s.id || dismissed.has(pairKey(s.id, o.id))) continue;
			const by = sameBy(s, o);
			if (by) {
				found[s.id] = looksSame(o, by);
				break;
			}
		}
	return found;
}

/** «No es repetido»: those two, not said again. */
export async function markNotSame(k: Kitchen, a: number, b: number) {
	if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) return;
	await k.run((tx) =>
		tx
			.insert(expenseNotDuplicate)
			.values({ familyId: k.familyId, a: Math.min(a, b), b: Math.max(a, b) })
			.onConflictDoNothing()
	);
}
