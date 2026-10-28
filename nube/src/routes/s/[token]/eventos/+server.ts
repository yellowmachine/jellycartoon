import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sseResponse } from '#lib/server/sse.ts';
import { TOKEN } from '#lib/server/trips/share-store.ts';
import { trips } from '#lib/server/trips/share.ts';

/** The trip as whoever watches gets it: `gone` if there is none, or no more (not even its name). */
const view = (token: string) => {
	const trip = trips.get(token);
	return trip && !trip.ended ? trip : { gone: true };
};

/** A shared trip, live (#81): on every news, and at once. */
export const GET: RequestHandler = ({ params, request }) => {
	if (!TOKEN.test(params.token)) error(404, 'No encontrado');
	const token = params.token;
	return sseResponse(request, (listener) => {
		listener(view(token));
		return trips.watch(token, () => listener(view(token)));
	});
};
