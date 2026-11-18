import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withFamily } from '#lib/server/family.ts';
import { coverOf } from '#lib/server/own-music.ts';
import { fileResponse } from '#lib/server/storage.ts';

/**
 * An album's cover in «Tu música» (#534): the picture in the bucket, by a presigned address, or the
 * one that was inside a track, from the family's storage. Another family's, or none: 404.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const id = Number(params.id);
	if (!Number.isSafeInteger(id)) error(404, 'No está');
	const familyId = await withFamily(locals.user!.id, async (_, m) => m.familyId);
	const cover = await coverOf(familyId, id);
	if (!cover) error(404, 'No está');
	if (cover.url !== undefined) redirect(302, cover.url, { external: true });
	return fileResponse(familyId, cover.area, cover.file, cover.type);
};
