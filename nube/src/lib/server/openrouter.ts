/**
 * OpenRouter (https://openrouter.ai), with the family's own key (family-settings.ts): an answer as
 * JSON to a schema, as jellycartoon's `completeJson`. No spending record yet (#193).
 */

/** jellycartoon's default for short tasks. */
export const DEFAULT_MODEL = 'anthropic/claude-haiku-5.5';

export async function completeJson<T>(request: {
	apiKey: string;
	system: string;
	prompt: string;
	/** Name of the schema, e.g. `recipe`. */
	name: string;
	schema: Record<string, unknown>;
	model?: string;
	timeoutMs?: number;
	/** Longest answer, in tokens: without it OpenRouter reserves credit for the model's longest. */
	maxTokens?: number;
}): Promise<T> {
	const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${request.apiKey}`,
			'Content-Type': 'application/json',
			'X-OpenRouter-Title': 'Nube'
		},
		body: JSON.stringify({
			model: request.model ?? DEFAULT_MODEL,
			messages: [
				{ role: 'system', content: request.system },
				{ role: 'user', content: request.prompt }
			],
			max_tokens: request.maxTokens ?? 16_384,
			response_format: {
				type: 'json_schema',
				json_schema: { name: request.name, strict: true, schema: request.schema }
			},
			// Only providers that honour the schema.
			provider: { require_parameters: true }
		}),
		signal: AbortSignal.timeout(request.timeoutMs ?? 60_000)
	});
	const body = await res.json().catch(() => null);
	if (res.status === 401) throw new Error('OpenRouter no acepta la clave: cámbiala en Ajustes');
	if (res.status === 402) throw new Error('No queda saldo en OpenRouter');
	if (!res.ok) throw new Error(`OpenRouter: ${body?.error?.message ?? res.status}`);
	// Errors once the provider has started answering come with a 200, inside the choice.
	const choice = body?.choices?.[0];
	const content = choice?.message?.content;
	if (typeof content !== 'string' || !content.trim())
		throw new Error(
			`OpenRouter: respuesta vacía${choice?.error?.message ? `: ${choice.error.message}` : ''}`
		);
	if (choice.finish_reason === 'length')
		throw new Error('OpenRouter: la respuesta se cortó por larga');
	return JSON.parse(content) as T;
}
