import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { moreSongs } from '#lib/server/music/dj-requests.ts';

/** Modo DJ in the browser: more songs at random, of those artists, not the ones already queued. */
export const POST: RequestHandler = async ({ request }) =>
	json(await moreSongs(await request.json().catch(() => null)));
