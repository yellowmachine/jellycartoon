import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withFamily } from '#lib/server/family.ts';
import { ownDjClipAudio } from '#lib/server/own-music-dj.ts';

/** What the DJ said (#534), only to its family. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const familyId = await withFamily(locals.user!.id, async (_, m) => m.familyId);
	const audio = await ownDjClipAudio(familyId, params.id);
	if (!audio) error(404, 'No está');
	return new Response(new Uint8Array(audio), {
		headers: { 'Content-Type': 'audio/ogg', 'Cache-Control': 'private, max-age=43200' }
	});
};
