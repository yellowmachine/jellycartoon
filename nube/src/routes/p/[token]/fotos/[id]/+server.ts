import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFile } from '#lib/server/storage.ts';
import { sharedWalks } from '#lib/server/walks/shared.ts';
import { PHOTOS_AREA } from '#lib/server/walks/walks.ts';
import { withoutMetadata } from '#lib/server/walks/no-exif.ts';

/**
 * A shared walk's photo (#434), for whoever has the link: checked on every request, never kept by
 * the browser (taken back, it stops at once), and without what the camera wrote in it (the GPS).
 */
export const GET: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	const found = Number.isInteger(id) ? await sharedWalks.photo(params.token, id) : null;
	if (!found) error(404, 'Foto no encontrada');
	const bytes = await readFile(found.familyId, PHOTOS_AREA, found.file);
	const clean = bytes && withoutMetadata(bytes);
	if (!clean) error(404, 'Foto no encontrada');
	return new Response(clean.bytes, {
		headers: {
			'content-type': clean.type,
			'cache-control': 'no-store',
			'x-robots-tag': 'noindex, nofollow',
			'referrer-policy': 'no-referrer'
		}
	});
};
