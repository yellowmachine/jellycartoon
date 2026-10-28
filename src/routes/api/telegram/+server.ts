import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isKid } from '#lib/server/kids.ts';
import { sseResponse } from '#lib/server/sse.ts';
import { watchTelegram } from '#lib/server/telegram/telegram.ts';
import type { TelegramMessage } from 'comun/telegram.ts';

/**
 * The messages that come to this person's Telegram account (#243), live, while the road mode has
 * it open with «Leer en voz alta»: each one as it comes. Nothing is kept for later.
 */
export const GET: RequestHandler = async ({ request, locals }) => {
	if (!locals.user || isKid(locals.user)) error(404, 'No encontrado');
	const userId = locals.user.id;
	return sseResponse<TelegramMessage>(request, (listener) => watchTelegram(userId, listener));
};
