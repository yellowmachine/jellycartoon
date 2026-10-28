import type { RequestHandler } from './$types';
import { askHouse, HouseProblem } from '#lib/server/house.ts';

/** Said aloud (#243): the house marks it read in Telegram, if the person asked for it. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { key } = await request.json().catch(() => ({}));
	if (typeof key === 'string')
		await askHouse(locals.user!.id, locals.user!.email, '/telegram/leido', {
			method: 'POST',
			body: JSON.stringify({ key })
		}).catch((err) => {
			// Not read in Telegram: it was said all the same.
			if (!(err instanceof HouseProblem)) throw err;
		});
	return new Response(null, { status: 204 });
};
