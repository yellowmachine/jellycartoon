import { and, eq, ne } from 'drizzle-orm';
import { weekday } from 'comun/agenda.ts';
import { euros } from 'comun/expenses.ts';
import { familyMember, inbox } from '#lib/server/db/schema.ts';
import { asFamily } from '#lib/server/family.ts';
import { houseKitchen } from '#lib/server/fridge.ts';
import { keepInInbox } from '#lib/server/inbox-store.ts';
import { summaryChoice, summaryOf, summaryOff } from '#lib/server/summary.ts';
import { summaryNotice, type NoticeView } from '#lib/summary.ts';
import { walkDistanceText } from '#lib/walks.ts';

/**
 * Resumen, phase 4 (#624): when a week (on Monday) or a month (on the 1st) is over, «Ya está el
 * resumen…» in the Buzón of each adult who asked for it (Ajustes → Para mí → Resumen), with the
 * main of their blocks and the way to it, where «Guardar como informe» is. Only in the Buzón, not
 * on the phone; never kept as a report by itself. Once each: one there already, read or not, is
 * not sent again after a restart.
 */

/** The periods over today: Monday, last week; the 1st, last month. */
export function overToday(today: string): NoticeView[] {
	const over: NoticeView[] = [];
	if (weekday(today) === 0) over.push('semana');
	if (today.endsWith('-01')) over.push('mes');
	return over;
}

export async function sendSummaryNotices(familyId: string, today: string, now = new Date()) {
	const over = overToday(today);
	if (!over.length) return;
	const k = houseKitchen(familyId);
	const adults = await asFamily(familyId, (tx) =>
		tx.select({ id: familyMember.userId }).from(familyMember).where(ne(familyMember.role, 'peque'))
	);
	for (const { id: userId } of adults) {
		const { notice } = await summaryChoice(k, userId);
		const views = over.filter((v) => notice.includes(v));
		if (!views.length) continue;
		const off = await summaryOff(k, userId);
		for (const view of views) {
			const s = await summaryOf(k, userId, view, null, today, off, now);
			const told = summaryNotice(
				{ ...s, charges: [], next: null },
				{ euros, km: walkDistanceText }
			);
			if (!told) continue;
			const [already] = await asFamily(familyId, (tx) =>
				tx
					.select({ id: inbox.id })
					.from(inbox)
					.where(and(eq(inbox.userId, userId), eq(inbox.tag, told.tag)))
					.limit(1)
			);
			if (already) continue;
			await keepInInbox(k, [userId], { kind: 'resumen', ...told, ttl: 0 });
		}
	}
}
