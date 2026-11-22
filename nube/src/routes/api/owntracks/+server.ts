import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { basicPassword, parseLocation } from '#lib/owntracks.ts';
import { owntracks } from '#lib/server/owntracks/owntracks.ts';

/** Bigger than any message OwnTracks sends: anything larger is not one of its. */
const MAX_BYTES = 16 * 1024;

/**
 * OwnTracks (#593): each message the person's phone sends in HTTP mode, with their password as
 * Basic auth (no session). Only its positions are kept; anything else (a region, a friend deleted,
 * an empty message) is answered all the same, so the app does not keep it to send again. The
 * answer it expects: 200 and `[]` (owntracks.org/booklet/tech/http).
 */
export const POST: RequestHandler = async ({ request }) => {
	const userId = await owntracks.userOf(basicPassword(request.headers.get('authorization')));
	if (!userId)
		return new Response('Unauthorized', {
			status: 401,
			headers: { 'www-authenticate': 'Basic realm="Seilide"' }
		});
	const text = await request.text();
	if (text.length > MAX_BYTES) return new Response('Too large', { status: 413 });
	let body: unknown;
	try {
		body = text ? JSON.parse(text) : null;
	} catch {
		return new Response('Bad JSON', { status: 400 });
	}
	const point = parseLocation(body, request.headers.get('x-limit-d'));
	if (point) await owntracks.save(userId, point);
	return json([]);
};
