import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { companionSeen } from '#lib/server/companion.ts';

/**
 * «Ya lo he mirado» in a notice of «Compañía» (#469), from the service worker with the session's
 * cookie: the alert of that linked family closed for all.
 */
export const POST: RequestHandler = async ({ url, locals }) => {
	const familyId = url.searchParams.get('familia');
	if (!familyId) error(400, 'Falta la familia');
	if (!(await companionSeen(locals.user!.id, locals.user!.name, familyId)))
		error(404, 'Esa familia no está vinculada con la tuya');
	return new Response(null, { status: 204 });
};
