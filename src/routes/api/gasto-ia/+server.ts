import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { watchAiSpend } from '#lib/server/ai-spend.ts';
import { isKid } from '#lib/server/kids.ts';
import { sseResponse } from '#lib/server/sse.ts';
import type { AiSpend } from 'comun/ai-spend.ts';

/** The AI's spending (#193), live, for the line under the header: the adults'. */
export const GET: RequestHandler = async ({ request, locals }) => {
	if (isKid(locals.user)) error(404, 'No encontrado');
	return sseResponse<AiSpend | null>(request, watchAiSpend);
};
