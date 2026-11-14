import { error, json } from '@sveltejs/kit';
import { chatHistory } from '#lib/server/chat.ts';
import { openRouterKey } from '#lib/server/family-settings.ts';
import { kitchenOf, toBuy } from '#lib/server/fridge.ts';
import type { RequestHandler } from './$types';

/**
 * The chat for the side panel (#504), opened from any page: the same as /preguntar's page loads.
 * Its own person's only; children never get here (not in kids.ts's KID_APIS).
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401);
	const k = await kitchenOf(locals.user.id);
	const [messages, buying, apiKey] = await Promise.all([
		chatHistory(k, locals.user.id),
		toBuy(k),
		openRouterKey(k)
	]);
	return json({ messages, toBuy: buying, hasAi: Boolean(apiKey) });
};
