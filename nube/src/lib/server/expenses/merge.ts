import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, notExists, or } from 'drizzle-orm';
import { addDays, daysBetween } from 'comun/agenda.ts';
import { addMonths } from 'comun/expenses.ts';
import type { MergeNotice, MergedNotice } from 'comun/page-notices.ts';
import {
	bankPayment,
	bill,
	expense,
	expenseLine,
	expenseMerge,
	expenseNotDuplicate,
	familyMember,
	familyPerson,
	wish,
	type MergedPart
} from '#lib/server/db/schema.ts';
import type { AnyDb } from '#lib/server/family-scope.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { noticeOn } from '#lib/server/page-notices.ts';
import { CHOOSE_DAYS, MERGE_DAYS, partsOf, type Part, type Whole } from './merge-match.ts';

/**
 * A bill, a receipt or a bank's payment that gathers expenses already put in one by one (bought from
 * Deseos, or by hand): said, and with «Juntarlos» left in one. Never by itself; «Separarlos» undoes it.
 */

/** What may be gathered: by hand or by voice, and nothing of its own to keep. */
const MAY = and(
	inArray(expense.source, ['mano', 'voz']),
	isNull(expense.receipt),
	isNull(expense.recurringId),
	isNull(expense.currency)
);

/** Between two days, or these; without another adult's gifts, which a bill would tell. */
async function partsWhere(tx: AnyDb, where: ReturnType<typeof and>): Promise<Part[]> {
	const rows = await tx
		.select({
			id: expense.id,
			date: expense.date,
			store: expense.store,
			total: expense.total
		})
		.from(expense)
		.where(
			and(
				MAY,
				where,
				notExists(
					tx.select({ id: bill.expenseId }).from(bill).where(eq(bill.expenseId, expense.id))
				)
			)
		)
		.orderBy(asc(expense.date), asc(expense.id));
	if (!rows.length) return [];
	const ids = rows.map((r) => r.id);
	const [lines, wishes] = await Promise.all([
		tx
			.select({ id: expenseLine.expenseId, text: expenseLine.text })
			.from(expenseLine)
			.where(inArray(expenseLine.expenseId, ids)),
		tx
			.select({
				id: wish.expenseId,
				title: wish.title,
				boughtBy: wish.boughtBy,
				owner: familyPerson.userId,
				role: familyMember.role
			})
			.from(wish)
			.innerJoin(familyPerson, eq(familyPerson.id, wish.personId))
			.leftJoin(familyMember, eq(familyMember.userId, familyPerson.userId))
			.where(inArray(wish.expenseId, ids))
	]);
	const secret = new Set(
		wishes
			.filter((w) => w.owner !== null && w.role !== 'peque' && w.owner !== w.boughtBy)
			.map((w) => w.id)
	);
	return rows
		.filter((r) => !secret.has(r.id))
		.map((r) => ({
			...r,
			titles: [
				...wishes.filter((w) => w.id === r.id).map((w) => w.title),
				...lines.filter((l) => l.id === r.id).map((l) => l.text)
			]
		}));
}

const near = (from: string, to: string, days = MERGE_DAYS) =>
	and(gte(expense.date, addDays(from, -days)), lte(expense.date, addDays(to, days)));

const said = (parts: Part[]): MergeNotice =>
	parts.map((p) => ({
		id: p.id,
		date: p.date,
		total: p.total,
		text: p.titles[0] ?? p.store,
		store: p.store
	}));

/** Those that may be gathered by one of that day, to choose by hand: the nearest day first. */
export async function mergeable(k: Kitchen, day: string): Promise<MergeNotice> {
	const parts = await k.run((tx) => partsWhere(tx, near(day, day, CHOOSE_DAYS)));
	const apart = (p: Part) => Math.abs(daysBetween(day, p.date));
	return said(parts.sort((a, b) => apart(a) - apart(b) || b.id - a.id));
}

/** Those a bill or receipt just read gathers, to ask; null, none or with the notice off. */
export async function mergeOfDraft(
	k: Kitchen,
	draft: Whole & { date: string; bill?: unknown }
): Promise<MergeNotice | null> {
	// A supply's bill gathers nothing.
	if (draft.bill || !(await noticeOn(k, 'junta'))) return null;
	const parts = await k.run((tx) => partsWhere(tx, near(draft.date, draft.date)));
	const found = partsOf(draft, parts);
	return found && said(found);
}

/** A month's (`YYYY-MM`) that gather others, already saved: each one's id, with those. */
export async function monthMerges(k: Kitchen, month: string): Promise<Record<number, MergeNotice>> {
	if (!(await noticeOn(k, 'junta'))) return {};
	const from = `${month}-01`;
	const to = addDays(`${addMonths(month, 1)}-01`, -1);
	return k.run(async (tx) => {
		const wholes = await tx
			.select({ id: expense.id, date: expense.date, store: expense.store, total: expense.total })
			.from(expense)
			.where(
				and(
					gte(expense.date, from),
					lte(expense.date, to),
					isNull(expense.recurringId),
					or(isNotNull(expense.receipt), eq(expense.source, 'banco')),
					notExists(
						tx.select({ id: bill.expenseId }).from(bill).where(eq(bill.expenseId, expense.id))
					)
				)
			)
			.orderBy(asc(expense.id));
		if (!wholes.length) return {};
		const parts = await partsWhere(tx, near(from, to));
		if (!parts.length) return {};
		const ids = wholes.map((w) => w.id);
		const [lines, not] = await Promise.all([
			tx
				.select({
					id: expenseLine.expenseId,
					text: expenseLine.text,
					amount: expenseLine.amount
				})
				.from(expenseLine)
				.where(inArray(expenseLine.expenseId, ids)),
			tx
				.select()
				.from(expenseNotDuplicate)
				.where(or(inArray(expenseNotDuplicate.a, ids), inArray(expenseNotDuplicate.b, ids)))
		]);
		const found: Record<number, MergeNotice> = {};
		for (const w of wholes) {
			const theirs = parts.filter(
				(p) =>
					p.date >= addDays(w.date, -MERGE_DAYS) &&
					p.date <= addDays(w.date, MERGE_DAYS) &&
					!not.some((n) => (n.a === w.id && n.b === p.id) || (n.a === p.id && n.b === w.id))
			);
			const gathers = partsOf({ ...w, lines: lines.filter((l) => l.id === w.id) }, theirs);
			if (gathers) found[w.id] = said(gathers);
		}
		return found;
	});
}

/**
 * «Juntarlos»: those gone, what pointed at them pointing at `into`. False if something is not there
 * any more or may not be gathered: then nothing is done.
 */
export function mergeInto(k: Kitchen, into: number, ids: number[]) {
	const asked = [...new Set(ids)];
	if (!asked.length || asked.includes(into)) return Promise.resolve(false);
	return k.run(async (tx) => {
		// Locked, all of them: two pages at once gather them once.
		const locked = await tx
			.select()
			.from(expense)
			.where(inArray(expense.id, [into, ...asked]))
			.orderBy(asc(expense.id))
			.for('update');
		const whole = locked.find((e) => e.id === into);
		if (!whole || (!whole.receipt && whole.source !== 'banco')) return false;
		const parts = await partsWhere(tx, inArray(expense.id, asked));
		if (parts.length !== asked.length) return false;
		const [lines, wishes, payments] = await Promise.all([
			tx
				.select()
				.from(expenseLine)
				.where(inArray(expenseLine.expenseId, [into, ...asked]))
				.orderBy(asc(expenseLine.position)),
			tx
				.select({ id: wish.id, expenseId: wish.expenseId })
				.from(wish)
				.where(inArray(wish.expenseId, asked)),
			tx
				.select({ id: bankPayment.id, expenseId: bankPayment.expenseId })
				.from(bankPayment)
				.where(inArray(bankPayment.expenseId, asked))
		]);
		const kept = asked.map((id): MergedPart => {
			const e = locked.find((r) => r.id === id)!;
			return {
				date: e.date,
				store: e.store,
				category: e.category,
				total: e.total,
				source: e.source as 'mano' | 'voz',
				userId: e.userId,
				lines: lines
					.filter((l) => l.expenseId === id)
					.map(({ text, quantity, amount, tag }) => ({ text, quantity, amount, tag })),
				wishes: wishes.filter((w) => w.expenseId === id).map((w) => w.id),
				payments: payments.filter((p) => p.expenseId === id).map((p) => p.id)
			};
		});
		const theirs = kept.flatMap((p) => p.lines);
		const tookLines = !lines.some((l) => l.expenseId === into) && theirs.length > 0;
		if (tookLines)
			await tx
				.insert(expenseLine)
				.values(
					theirs.map((l, position) => ({ ...l, familyId: k.familyId, expenseId: into, position }))
				);
		if (wishes.length)
			await tx.update(wish).set({ expenseId: into }).where(inArray(wish.expenseId, asked));
		if (payments.length)
			await tx
				.update(bankPayment)
				.set({ expenseId: into })
				.where(inArray(bankPayment.expenseId, asked));
		await tx
			.insert(expenseMerge)
			.values({ familyId: k.familyId, expenseId: into, parts: kept, tookLines });
		await tx.delete(expense).where(inArray(expense.id, asked));
		return true;
	});
}

/** «Separarlos»: put back as they were, but for what was changed since. False if it is not there. */
export function splitMerge(k: Kitchen, id: number) {
	return k.run(async (tx) => {
		const [m] = await tx.delete(expenseMerge).where(eq(expenseMerge.id, id)).returning();
		if (!m) return false;
		if (m.tookLines) await tx.delete(expenseLine).where(eq(expenseLine.expenseId, m.expenseId));
		const members = await tx.select({ id: familyMember.userId }).from(familyMember);
		for (const { lines, wishes, payments, userId, ...values } of m.parts) {
			const [row] = await tx
				.insert(expense)
				.values({
					...values,
					familyId: k.familyId,
					// Their account gone since, nobody's.
					userId: members.some((x) => x.id === userId) ? userId : null
				})
				.returning({ id: expense.id });
			const expenseId = row!.id;
			if (lines.length)
				await tx
					.insert(expenseLine)
					.values(
						lines.map((l, position) => ({ ...l, familyId: k.familyId, expenseId, position }))
					);
			if (wishes.length)
				await tx
					.update(wish)
					.set({ expenseId })
					.where(and(inArray(wish.id, wishes), eq(wish.expenseId, m.expenseId)));
			if (payments.length)
				await tx
					.update(bankPayment)
					.set({ expenseId })
					.where(and(inArray(bankPayment.id, payments), eq(bankPayment.expenseId, m.expenseId)));
			// Just separated: not proposed again.
			await tx
				.insert(expenseNotDuplicate)
				.values({
					familyId: k.familyId,
					a: Math.min(m.expenseId, expenseId),
					b: Math.max(m.expenseId, expenseId)
				})
				.onConflictDoNothing();
		}
		return true;
	});
}

/** What a month's expenses gathered, to say it and to separate it. */
export async function monthMerged(k: Kitchen, month: string): Promise<MergedNotice[]> {
	const rows = await k.run((tx) =>
		tx
			.select({ id: expenseMerge.id, expenseId: expenseMerge.expenseId, parts: expenseMerge.parts })
			.from(expenseMerge)
			.innerJoin(expense, eq(expense.id, expenseMerge.expenseId))
			.where(
				and(
					gte(expense.date, `${month}-01`),
					lte(expense.date, addDays(`${addMonths(month, 1)}-01`, -1))
				)
			)
			.orderBy(asc(expenseMerge.id))
	);
	return rows.map(({ parts, ...r }) => ({
		...r,
		parts: parts.map((p) => ({
			date: p.date,
			total: p.total,
			text: p.lines.length === 1 ? p.lines[0]!.text : p.store
		}))
	}));
}
