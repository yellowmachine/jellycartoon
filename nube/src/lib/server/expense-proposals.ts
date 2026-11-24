import { and, eq, lt, sql } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import { isCategory, isDay, MAX_CENTS, parseEuros } from 'comun/expenses.ts';
import type { LooksSame } from 'comun/page-notices.ts';
import { inbox } from '#lib/server/db/schema.ts';
import { lookingSame } from '#lib/server/expenses/duplicates.ts';
import { addExpense } from '#lib/server/expenses/expenses.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { answerProposal, listInbox } from '#lib/server/inbox-store.ts';
import type { ExpenseProposal } from '#lib/server/inbox-store.ts';

/**
 * Expenses proposed by a rule when an event of the Agenda is marked as done (#600): kept only in the
 * Buzón of who marked it (propose-expense.ts), and shown under the event too; into Dinero only with their yes.
 */

/** Not answered in this long, gone. */
const KEEP_DAYS = 30;

/** One waiting for its answer, with the expense it looks the same as (#440), if any. */
export interface WaitingExpense {
	id: number;
	proposal: ExpenseProposal;
	repeated: LooksSame | null;
}

/** Theirs, waiting; the old ones, gone. */
export async function waitingExpenses(k: Kitchen, userId: string): Promise<WaitingExpense[]> {
	await k.run((tx) =>
		tx
			.delete(inbox)
			.where(
				and(
					eq(inbox.userId, userId),
					sql`${inbox.proposal}->>'type' = 'gasto'`,
					lt(inbox.createdAt, sql`now() - make_interval(days => ${KEEP_DAYS})`)
				)
			)
	);
	const waiting: WaitingExpense[] = [];
	for (const { id, proposal } of await listInbox(k, userId))
		if (proposal?.type === 'gasto')
			waiting.push({
				id,
				proposal,
				repeated: await sameAs(k, proposal.day, proposal.store, proposal.total)
			});
	return waiting;
}

const sameAs = (k: Kitchen, date: string, store: string, total: number) =>
	lookingSame(k, { id: null, date, store, total, source: 'mano', fileHash: null, bill: null });

/**
 * An event no longer done: what its rules proposed, to anyone, withdrawn if still waiting. The
 * rules whose proposal was.
 */
export async function withdrawExpenses(k: Kitchen, eventId: number, day: string) {
	const gone = await k.run((tx) =>
		tx
			.delete(inbox)
			.where(
				and(
					eq(inbox.familyId, k.familyId),
					sql`${inbox.proposal}->>'type' = 'gasto'`,
					sql`${inbox.proposal}->>'eventId' = ${String(eventId)}`,
					sql`${inbox.proposal}->>'day' = ${day}`
				)
			)
			.returning({ proposal: inbox.proposal })
	);
	return gone.flatMap(({ proposal }) => (proposal?.type === 'gasto' ? [proposal.ruleId] : []));
}

/**
 * Answered, under the event or in the Buzón (their form actions): «No» (`keep` false), or into
 * Dinero as the form has it.
 */
export async function answerExpense(k: Kitchen, userId: string, form: FormData) {
	const id = Number(form.get('id'));
	const waiting = (await listInbox(k, userId)).find((n) => n.id === id)?.proposal;
	if (waiting?.type !== 'gasto') return fail(404, { message: 'Ya estaba contestado' });
	if (form.get('keep') !== 'true') {
		await answerProposal(k, userId, id, false);
		return { expense: null };
	}
	const date = form.get('date');
	const total = parseEuros(String(form.get('price') ?? ''));
	const store = String(form.get('store') ?? '')
		.trim()
		.slice(0, 120);
	const category = form.get('category');
	if (!isDay(date)) return fail(400, { message: 'Falta la fecha' });
	if (total === null || total <= 0 || total > MAX_CENTS)
		return fail(400, { message: 'Falta el precio, en euros: 12,30' });
	if (!store || !isCategory(category))
		return fail(400, { message: 'Falta la tienda o la categoría' });
	if (form.get('igual') !== '1') {
		const repeated = await sameAs(k, date, store, total);
		if (repeated) return fail(409, { message: 'Parece repetido', repeated });
	}
	// Answered first: from two places at once, into Dinero once.
	if (!(await answerProposal(k, userId, id, true)))
		return fail(404, { message: 'Ya estaba contestado' });
	try {
		const input = { date, store, category, total, lines: [] };
		return {
			expense: await addExpense(k, input, 'mano', null, null, null, userId, null, false),
			month: date.slice(0, 7)
		};
	} catch (err) {
		await k.run((tx) =>
			tx.update(inbox).set({ proposal: waiting, readAt: null }).where(eq(inbox.id, id))
		);
		throw err;
	}
}
