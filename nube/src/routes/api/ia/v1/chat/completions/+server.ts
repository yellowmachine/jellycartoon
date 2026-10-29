import type { RequestHandler } from './$types';
import { appAiKey } from '#lib/server/app-ai.ts';
import { forwardChat } from '#lib/server/openrouter.ts';

/**
 * The apps' AI (#284), OpenAI's own shape, as OpenRouter's: an app points its OpenAI-compatible
 * client here (base URL `…/api/ia/v1`) with the person's access token as its key. `X-Title`, the
 * app's name as OpenRouter takes it, labels the cost in Gastos → IA.
 */
export const POST: RequestHandler = async ({ request }) => {
	const ai = await appAiKey(request);
	if (!ai.ok)
		return Response.json(
			{ error: { message: ai.message, code: ai.status } },
			{
				status: ai.status,
				headers: ai.status === 401 ? { 'WWW-Authenticate': 'Bearer' } : undefined
			}
		);
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object' || Array.isArray(body))
		return Response.json({ error: { message: 'Se esperaba JSON', code: 400 } }, { status: 400 });
	const app = (request.headers.get('x-title') ?? '').trim().slice(0, 60) || 'App';
	return forwardChat({ apiKey: ai.apiKey, label: app, body, signal: request.signal });
};
