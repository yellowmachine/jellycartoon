import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { isServiceAdmin } from '#lib/server/invitations.ts';
import { admin } from '#lib/server/admin.ts';
import { ACTIVE_DAYS, BACKUP_LATE_HOURS } from '#lib/server/admin-scope.ts';

/** Only the service's administrator (ADMIN_EMAIL): to anyone else, there is no such page. */
export const load: PageServerLoad = async ({ locals }) => {
	if (!isServiceAdmin(locals.user?.email)) error(404, 'Not found');
	const [counts, backups] = await Promise.all([admin.counts(), admin.backups()]);
	return { counts, backups, activeDays: ACTIVE_DAYS, lateHours: BACKUP_LATE_HOURS };
};
