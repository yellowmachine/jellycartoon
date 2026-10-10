import { openRouterConfig } from '#lib/server/app-settings.ts';

/**
 * One request to OpenRouter's chat completions API, answered as JSON that follows `schema`
 * (structured outputs): https://openrouter.ai/docs/features/structured-outputs
 */
export async function completeJson<T>(request: {
	system: string;
	prompt: string;
	/** Name of the schema, e.g. `film`. */
	name: string;
	schema: Record<string, unknown>;
}): Promise<T> {
	const { apiKey, model } = await openRouterConfig();
	if (!apiKey) throw new Error('No hay clave de OpenRouter: ponla en Ajustes');

	const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
			// Optional attribution, so the app shows by name in OpenRouter's activity page.
			'X-OpenRouter-Title': 'JellyCartoon'
		},
		body: JSON.stringify({
			model,
			messages: [
				{ role: 'system', content: request.system },
				{ role: 'user', content: request.prompt }
			],
			temperature: 0,
			response_format: {
				type: 'json_schema',
				json_schema: { name: request.name, strict: true, schema: request.schema }
			},
			// Only providers that honour the schema.
			provider: { require_parameters: true }
		}),
		signal: AbortSignal.timeout(60_000)
	});
	const body = await res.json().catch(() => null);
	if (!res.ok) throw new Error(`OpenRouter: ${body?.error?.message ?? res.statusText}`);
	const content = body?.choices?.[0]?.message?.content;
	if (typeof content !== 'string') throw new Error('OpenRouter: respuesta vacía');
	return JSON.parse(content) as T;
}
