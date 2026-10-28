import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { HouseProblem, houseStream } from '#lib/server/house.ts';

/**
 * The messages that come to this person's own Telegram (#243), live, for the road mode while it has
 * «Leer en voz alta» on. The account is the house's, which never gives its session away (#253): it
 * passes them on here (its /api/v1/telegram/mensajes), as they come.
 */
export const GET: RequestHandler = async ({ request, locals }) => {
	try {
		const body = await houseStream(
			locals.user!.id,
			locals.user!.email,
			'/telegram/mensajes',
			request.signal
		);
		return new Response(body, {
			headers: {
				'content-type': 'text/event-stream',
				'cache-control': 'no-cache',
				connection: 'keep-alive'
			}
		});
	} catch (err) {
		if (err instanceof HouseProblem) error(503, err.message);
		throw err;
	}
};
