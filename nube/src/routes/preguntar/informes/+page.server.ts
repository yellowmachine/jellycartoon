import type { PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { listReports } from '#lib/server/reports.ts';

/** Preguntar → Informes (#505): this person's reports, the newest first. Not for children (kids.ts). */
export const load: PageServerLoad = async ({ locals }) => {
	const k = await kitchenOf(locals.user!.id);
	return { reports: await listReports(k, locals.user!.id) };
};
