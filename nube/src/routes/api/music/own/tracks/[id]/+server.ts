import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withFamily } from '#lib/server/family.ts';
import { trackAddress } from '#lib/server/own-music.ts';

/**
 * A track of «Tu música» (#534): to its presigned address in the family's bucket, made now, so the
 * address kept in the queue never expires. Another family's, or gone: 404.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const id = Number(params.id);
	if (!Number.isSafeInteger(id)) error(404, 'No está');
	const familyId = await withFamily(locals.user!.id, async (_, m) => m.familyId);
	const url = await trackAddress(familyId, id);
	if (!url) error(404, 'No está');
	redirect(302, url, { external: true });
};
