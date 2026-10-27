import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { markSaid } from '#lib/server/telegram/telegram.ts';

/** Said aloud in the road mode (#243): marked read in Telegram, if the person asked for it. */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(404, 'No encontrado');
	const { key } = await request.json().catch(() => ({}));
	if (typeof key === 'string') await markSaid(locals.user.id, key);
	return new Response(null, { status: 204 });
};
