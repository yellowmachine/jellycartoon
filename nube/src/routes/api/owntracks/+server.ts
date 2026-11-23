import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { basicPassword, parseLocation, parseTransition } from '#lib/owntracks.ts';
import { dayOf, kitchenOf } from '#lib/server/fridge.ts';
import { owntracks } from '#lib/server/owntracks/owntracks.ts';
import { ruleEvent } from '#lib/server/rule-events.ts';

/** Bigger than any message OwnTracks sends: anything larger is not one of its. */
const MAX_BYTES = 16 * 1024;

/**
 * An arrival older than this, sent late (no coverage), is kept for the day but fires no rule: «al
 * llegar a casa» an hour later is no use.
 */
const FRESH_MS = 30 * 60_000;

/**
 * OwnTracks (#593): each message the person's phone sends in HTTP mode, with their password as
 * Basic auth (no session). Its positions are kept, and its arrivals at and leavings of their
 * places (phase 4), which fire their own rules «lugar». Anything else (a friend deleted, an empty
 * message) is answered all the same, so the app does not keep it to send again. The answer it
 * expects: 200 and `[]` (owntracks.org/booklet/tech/http).
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
	if (point) await owntracks.save(userId, point, dayOf);
	const transition = parseTransition(body);
	if (
		transition &&
		(await owntracks.saveTransition(userId, transition)) &&
		Date.now() - transition.at.getTime() < FRESH_MS
	) {
		const k = await kitchenOf(userId).catch(() => null);
		if (k)
			ruleEvent(k, 'lugar', transition.place, userId, [], undefined, undefined, {
				userId,
				name: transition.place,
				moment: transition.moment
			});
	}
	return json([]);
};
