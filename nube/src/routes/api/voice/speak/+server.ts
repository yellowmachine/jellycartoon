import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withChime } from 'comun/chime.ts';
import { openRouterKey } from '#lib/server/family-settings.ts';
import { creditProblem } from '#lib/server/ai-block.ts';
import { sayableError } from '#lib/server/openrouter.ts';
import { languagesOf, satelliteRequest } from '#lib/server/satellites.ts';
import { fillerSpeech, satelliteSpeech } from '#lib/server/voice/satellite-voice.ts';

/**
 * An answer is a sentence or three; one of the «Modelo para conversar» (converse.ts), a few more:
 * on 2026-11-02 one about Dennett went past the 1000 there were, and was not said.
 */
const MAX_CHARS = 2500;

/**
 * An answer read aloud for a satellite of Seilide's (#296), the house's path (its
 * /api/voice/speak): as a WAV, in the family's voice (Ajustes → Familia, satellite-voice.ts), with
 * its key; with `chime`, a timer's «din-don» before it. With `filler` instead of `text`, one of the
 * phrases said while the AI thinks, if it is already recorded; nothing (204) if not, or if the
 * satellite answers in another language than Spanish (#647). Without
 * credit, a 402: the satellite says its own phrase for it.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { k, satellite } = await satelliteRequest(request);
	const body = await request.json().catch(() => null);
	const text = typeof body?.text === 'string' ? body.text.trim() : '';
	if (!body?.filler && !text) error(400, 'Falta el texto');
	// The phrases while it thinks are in Spanish: none before an answer in another language (#647).
	if (body.filler && !['es', 'auto'].includes((await languagesOf(k, satellite.id)).answer))
		return new Response(null, { status: 204 });
	if (text.length > MAX_CHARS) error(413, 'Demasiado largo');
	const apiKey = await openRouterKey(k);
	if (!apiKey) error(503, 'La familia no tiene clave de IA: ponla en Ajustes de Seilide');
	try {
		const started = performance.now();
		const wav = body.filler
			? await fillerSpeech(k, apiKey)
			: await satelliteSpeech(k, apiKey, text);
		// The phrases are kept: only the answers are worth timing.
		if (!body.filler)
			console.info(
				`[voz] Dicho en ${Math.round(performance.now() - started)} ms (${text.length} letras)`,
				{ familyId: k.familyId }
			);
		if (!wav) return new Response(null, { status: 204 });
		return new Response(body.chime === true ? withChime(wav) : wav, {
			headers: { 'content-type': 'audio/wav' }
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[voz] Al decirlo: ${message}`, { familyId: k.familyId });
		error(creditProblem(message) ? 402 : 503, sayableError(message));
	}
};
