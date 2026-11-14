import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { isServiceAdmin } from '#lib/server/invitations.ts';
import { admin } from '#lib/server/admin.ts';
import { ACTIVE_DAYS, BACKUP_LATE_HOURS } from '#lib/server/admin-scope.ts';
import { dayOf, today } from '#lib/server/fridge.ts';
import { deviceLabel } from '#lib/device-label.ts';

/** Only the service's administrator (ADMIN_EMAIL): to anyone else, there is no such page. */
export const load: PageServerLoad = async ({ locals }) => {
	if (!isServiceAdmin(locals.user?.email)) error(404, 'Not found');
	const [counts, backups, seen] = await Promise.all([
		admin.counts(),
		admin.backups(),
		admin.lastSeen()
	]);
	const now = new Date(`${today()}T12:00:00Z`).getTime();
	return {
		counts,
		backups,
		/** «Última vez»: days since, by the house's day, and from what. */
		lastSeen: seen.map((p) => ({
			id: p.id,
			name: p.name,
			email: p.email,
			daysAgo: p.lastSeen
				? Math.round((now - new Date(`${dayOf(p.lastSeen)}T12:00:00Z`).getTime()) / 86_400_000)
				: null,
			device: deviceLabel(p.userAgent)
		})),
		activeDays: ACTIVE_DAYS,
		lateHours: BACKUP_LATE_HOURS
	};
};
