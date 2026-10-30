import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cloudViewer } from '#lib/server/media-api.ts';
import { continueWatching } from '#lib/server/watching.ts';

/** The video API (#253): this person's «Seguir viendo», as at home. */
export const GET: RequestHandler = async ({ request }) => {
	const person = await cloudViewer(request);
	return json({ episodes: await continueWatching(person.id) });
};
