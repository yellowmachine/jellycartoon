import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cloudViewer, musicPassLinks } from '#lib/server/media-api.ts';

/**
 * The music API (#253): a pass, for this person, to listen for some hours: where its tracks
 * (`<base>/pistas/<id>`, their Opus copy) and covers (`<base>/portadas/<album id>`) are, for the
 * browser to open them straight from the house.
 */
export const POST: RequestHandler = async ({ request }) => {
	const person = await cloudViewer(request);
	return json(musicPassLinks(person.id));
};
