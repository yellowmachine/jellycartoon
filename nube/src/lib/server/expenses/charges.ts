import { eq } from 'drizzle-orm';
import { daysBetween } from 'comun/agenda.ts';
import { nextDue } from 'comun/expenses.ts';
import { familyMember, recurringExpense } from '#lib/server/db/schema.ts';
import type { AnyDb } from '#lib/server/family-scope.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { noChoice, type Charge, type ChargeNotices } from '#lib/charges.ts';

/** «Cargos que vienen» (charges.ts): to who put the fixed one in, or to every adult if it says so. */

async function choiceOf(tx: AnyDb, userId: string): Promise<ChargeNotices> {
	const [row] = await tx
		.select({ choice: familyMember.chargeNotices })
		.from(familyMember)
		.where(eq(familyMember.userId, userId));
	return { ...noChoice(), ...row?.choice };
}

export const chargeNotices = (k: Kitchen, userId: string) => k.run((tx) => choiceOf(tx, userId));

/** Changed as it is now, locked: closing two at once keeps both. */
async function change(k: Kitchen, userId: string, by: (now: ChargeNotices) => ChargeNotices) {
	await k.run(async (tx) => {
		const [row] = await tx
			.select({ choice: familyMember.chargeNotices })
			.from(familyMember)
			.where(eq(familyMember.userId, userId))
			.for('update');
		if (!row) return;
		await tx
			.update(familyMember)
			.set({ chargeNotices: by({ ...noChoice(), ...row.choice }) })
			.where(eq(familyMember.userId, userId));
	});
}

export const setChargeNotices = (
	k: Kitchen,
	userId: string,
	choice: Pick<ChargeNotices, 'on' | 'monthly' | 'yearly'>
) => change(k, userId, (now) => ({ ...now, ...choice }));

/** «✕»: those charges, of those days; the next time they come again. The past ones closed, forgotten. */
export const closeCharges = (
	k: Kitchen,
	userId: string,
	list: { id: number; day: string }[],
	today: string
) =>
	change(k, userId, (now) => ({
		...now,
		closed: Object.fromEntries([
			...Object.entries(now.closed).filter(([, day]) => day >= today),
			...list.map(({ id, day }) => [String(id), day])
		])
	}));

/** Those to tell `userId` now, the nearest first. */
export async function comingCharges(k: Kitchen, userId: string, today: string): Promise<Charge[]> {
	const { mine, fixed } = await k.run(async (tx) => ({
		mine: await choiceOf(tx, userId),
		fixed: await tx.select().from(recurringExpense)
	}));
	if (!mine.on) return [];
	return fixed
		.flatMap((r): Charge[] => {
			// Whose account is gone, everyone's.
			if (r.userId !== null && r.userId !== userId && !r.noticeAll) return [];
			const before = r.notice ?? (r.month === null ? mine.monthly : mine.yearly);
			if (!before) return [];
			const day = nextDue(r, r.lastMonth, today);
			if (!day || mine.closed[r.id] === day) return [];
			const left = daysBetween(today, day);
			if (left > before) return [];
			return [{ id: r.id, name: r.name, amount: r.amount, day, left, account: r.paidFrom }];
		})
		.sort((a, b) => a.left - b.left || b.amount - a.amount);
}
