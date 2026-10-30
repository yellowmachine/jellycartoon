import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withChime } from 'comun/chime.ts';
import { openRouterKey } from '#lib/server/family-settings.ts';
import { NO_CREDIT, sayableError } from '#lib/server/openrouter.ts';
import { satelliteRequest } from '#lib/server/satellites.ts';
import { fillerSpeech, satelliteSpeech } from '#lib/server/voice/satellite-voice.ts';

/** An answer is a sentence or three: more than this is not one. */
const MAX_CHARS = 1000;

/**
 * An answer read aloud for a satellite of Seilide's (#296), the house's path (its
 * /api/voice/speak): as a WAV, in the family's voice (Ajustes → Familia, satellite-voice.ts), with
 * its key; with `chime`, a timer's «din-don» before it. With `filler` instead of `text`, one of the
 * phrases said while the AI thinks, if it is already recorded; nothing (204) if not. Without
 * credit, a 402: the satellite says its own phrase for it.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { k } = await satelliteRequest(request);
	const body = await request.json().catch(() => null);
	const text = typeof body?.text === 'string' ? body.text.trim() : '';
	if (!body?.filler && !text) error(400, 'Falta el texto');
	if (text.length > MAX_CHARS) error(413, 'Demasiado largo');
	const apiKey = await openRouterKey(k);
	if (!apiKey) error(503, 'La familia no tiene clave de IA: ponla en Ajustes de Seilide');
	try {
		const wav = body.filler
			? await fillerSpeech(k, apiKey)
			: await satelliteSpeech(k, apiKey, text);
		if (!wav) return new Response(null, { status: 204 });
		return new Response(body.chime === true ? withChime(wav) : wav, {
			headers: { 'content-type': 'audio/wav' }
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[voz] Al decirlo: ${message}`, { familyId: k.familyId });
		error(message === NO_CREDIT ? 402 : 503, sayableError(message));
	}
};
