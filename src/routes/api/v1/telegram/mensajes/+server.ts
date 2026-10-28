import type { RequestHandler } from './$types';
import { cloudPerson } from '#lib/server/media-api.ts';
import { sseResponse } from '#lib/server/sse.ts';
import { watchTelegram } from '#lib/server/telegram/telegram.ts';
import type { TelegramMessage } from 'comun/telegram.ts';

/**
 * The messages that come to this person's Telegram (#243), live, for the cloud's road mode (#253),
 * which passes them to their phone to be read aloud: each one as it comes, nothing kept.
 */
export const GET: RequestHandler = async ({ request }) => {
	const person = await cloudPerson(request);
	return sseResponse<TelegramMessage>(request, (listener) => watchTelegram(person.id, listener));
};
