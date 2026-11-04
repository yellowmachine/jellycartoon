import type { RequestHandler } from './$types';
import { houseAiRequest } from '#lib/server/app-ai.ts';
import { forwardSpeech } from '#lib/server/openrouter.ts';

/**
 * The house's AI with the family's key (its speech: the DJ, the voice read aloud), as the apps' (/api/ia/v1), with
 * the house's key (`x-api-key`) instead of a person's token.
 */
export const POST: RequestHandler = ({ request }) => houseAiRequest(request, forwardSpeech);
