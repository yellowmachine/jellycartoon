import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cloudPerson } from '#lib/server/media-api.ts';
import { markSaid } from '#lib/server/telegram/telegram.ts';

/** Said aloud in the cloud's road mode (#253): marked read in Telegram, if the person asked for it. */
export const POST: RequestHandler = async ({ request }) => {
	const person = await cloudPerson(request);
	const { key } = await request.json().catch(() => ({}));
	if (typeof key === 'string') await markSaid(person.id, key);
	return json({ ok: true });
};
