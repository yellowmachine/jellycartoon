import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { isServiceAdmin } from '#lib/server/invitations.ts';
import { admin } from '#lib/server/admin.ts';
import { ACTIVE_DAYS, BACKUP_LATE_HOURS } from '#lib/server/admin-scope.ts';
import { dayOf, today } from '#lib/server/fridge.ts';
import { deviceLabel } from '#lib/device-label.ts';
import { sectionLabel } from '#lib/nav.ts';
import { visits } from '#lib/server/section-visits.ts';
import { USAGE_DAYS } from '#lib/server/section-visits-scope.ts';

/** Only the service's administrator (ADMIN_EMAIL): to anyone else, there is no such page. */
export const load: PageServerLoad = async ({ locals }) => {
	if (!isServiceAdmin(locals.user?.email)) error(404, 'Not found');
	const [counts, backups, seen, usage, lastVisits] = await Promise.all([
		admin.counts(),
		admin.backups(),
		admin.lastSeen(),
		visits.usage(),
		visits.lastVisits()
	]);
	const now = new Date(`${today()}T12:00:00Z`).getTime();
	return {
		counts,
		backups,
		/** «Última vez»: days since, by the house's day, and from what. */
		lastSeen: seen
			.map((p) => {
				// A section opened says the very moment; the session, only the day.
				const visit = lastVisits.get(p.id) ?? null;
				const last = visit && (!p.lastSeen || visit > p.lastSeen) ? visit : p.lastSeen;
				return {
					id: p.id,
					name: p.name,
					email: p.email,
					daysAgo: last
						? Math.round((now - new Date(`${dayOf(last)}T12:00:00Z`).getTime()) / 86_400_000)
						: null,
					/** When, to the minute: only with a section opened. */
					at: visit && last === visit ? visit : null,
					sortAt: last?.getTime() ?? 0,
					device: deviceLabel(p.userAgent),
					/** «Qué usa»: their sections of the last week, the most opened first. */
					sections: usage
						.filter((u) => u.userId === p.id)
						.sort((a, b) => b.visits - a.visits || b.lastAt.getTime() - a.lastAt.getTime())
						.map((u) => ({ label: sectionLabel(u.section), visits: u.visits }))
				};
			})
			.sort((a, b) => b.sortAt - a.sortAt),
		usageDays: USAGE_DAYS,
		activeDays: ACTIVE_DAYS,
		lateHours: BACKUP_LATE_HOURS
	};
};
