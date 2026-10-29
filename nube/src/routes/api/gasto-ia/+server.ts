import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { AiSpend } from 'comun/ai-spend.ts';
import { watchAiSpend } from '#lib/server/ai-spend.ts';
import { openRouterKey } from '#lib/server/family-settings.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { sseResponse } from '#lib/server/sse.ts';

/** The AI's spending (#193), live, for the line under the header: with the family's key. */
export const GET: RequestHandler = async ({ request, locals }) => {
	const apiKey = await openRouterKey(await kitchenOf(locals.user!.id));
	if (!apiKey) error(404, 'No encontrado');
	return sseResponse<AiSpend | null>(request, (listener) => watchAiSpend(apiKey, listener));
};
