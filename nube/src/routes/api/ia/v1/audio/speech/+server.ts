import type { RequestHandler } from './$types';
import { appAiRequest } from '#lib/server/app-ai.ts';
import { forwardSpeech } from '#lib/server/openrouter.ts';

/**
 * The apps' speech (#284: Langua reads aloud, without its own Piper), as the chat's
 * (../../chat/completions): OpenAI's `audio/speech`, as OpenRouter's, with the person's access token
 * as the key. Its cost is not in Gastos → IA: the audio comes without it (`forwardSpeech`).
 */
export const POST: RequestHandler = ({ request }) => appAiRequest(request, forwardSpeech);
