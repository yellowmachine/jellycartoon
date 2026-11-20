import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { creditProblem } from '#lib/server/ai-block.ts';
import { openRouterKey } from '#lib/server/family-settings.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { sayableError } from '#lib/server/openrouter.ts';
import { fillerSpeech, satelliteSpeech } from '#lib/server/voice/satellite-voice.ts';

/** As a satellite's (api/voice/speak): an answer is a sentence or three, a conversation's more. */
const MAX_CHARS = 2500;

/**
 * An answer read aloud in the Vista (the house's screen, #525) in the family's voice, the
 * satellites' (Ajustes → Familia, satellite-voice.ts), so it sounds as fast and the same as them:
 * a WAV, with the family's key. With `filler` instead of `text`, one of the phrases said while the
 * AI thinks, if it is already recorded; nothing (204) if not. Without credit, a 402; any failure,
 * the page reads it with the device's own voice instead.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const body = await request.json().catch(() => null);
	const text = typeof body?.text === 'string' ? body.text.trim() : '';
	if (!body?.filler && !text) error(400, 'Falta el texto');
	if (text.length > MAX_CHARS) error(413, 'Demasiado largo');
	const apiKey = await openRouterKey(k);
	if (!apiKey) error(503, 'La familia no tiene clave de IA');
	try {
		const started = performance.now();
		const wav = body.filler
			? await fillerSpeech(k, apiKey)
			: await satelliteSpeech(k, apiKey, text);
		if (!body.filler)
			console.info(
				`[voz] Dicho en la Vista en ${Math.round(performance.now() - started)} ms (${text.length} letras)`,
				{ familyId: k.familyId }
			);
		if (!wav) return new Response(null, { status: 204 });
		return new Response(wav, { headers: { 'content-type': 'audio/wav' } });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[voz] Al decirlo en la Vista: ${message}`, { familyId: k.familyId });
		error(creditProblem(message) ? 402 : 503, sayableError(message));
	}
};
