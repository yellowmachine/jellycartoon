import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { djWords } from '#lib/server/music/dj-requests.ts';

/** Modo DJ in the browser: what the DJ says after the songs since it last spoke (dj-requests.ts). */
export const POST: RequestHandler = async ({ request }) =>
	json(await djWords(await request.json().catch(() => null)));
