import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cloudPerson } from '#lib/server/media-api.ts';
import { telegramOf } from '#lib/server/telegram/telegram.ts';

/**
 * Whether this person's own Telegram (#243) is connected here, for the cloud's road mode (#253):
 * the account stays in the house, which only passes on what comes.
 */
export const GET: RequestHandler = async ({ request }) => {
	const person = await cloudPerson(request);
	return json({ connected: Boolean(await telegramOf(person.id)) });
};
