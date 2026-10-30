import type { RequestHandler } from './$types';
import { appAiRequest } from '#lib/server/app-ai.ts';
import { forwardChat } from '#lib/server/openrouter.ts';

/**
 * The apps' AI (#284), OpenAI's own shape, as OpenRouter's: an app points its OpenAI-compatible
 * client here (base URL `…/api/ia/v1`) with the person's access token as its key. `X-Title`, the
 * app's name as OpenRouter takes it, labels the cost in Gastos → IA.
 */
export const POST: RequestHandler = ({ request }) => appAiRequest(request, forwardChat);
