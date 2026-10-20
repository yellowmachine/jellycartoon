import { error, json } from '@sveltejs/kit';
import { isAdmin } from '#lib/server/app-settings.ts';
import { isKid } from '#lib/server/kids.ts';
import { pendingUpdates } from '#lib/server/updates.ts';
import type { RequestHandler } from './$types';

/** For UpdateProgress (#20): whether WUD has finished with every container, not only the app. */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || isKid(locals.user) || !(await isAdmin(locals.user.id)))
		error(404, 'No encontrado');
	return json({ pending: await pendingUpdates() });
};
