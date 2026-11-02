import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '#lib/server/log.ts';
import { isPiperVoice, piperEnabled } from '#lib/server/piper.ts';
import { houseSpeech } from '#lib/server/voice/house-speech.ts';

/** A sentence or three: more than this is not one. */
const MAX_CHARS = 1000;

/**
 * Text read aloud as the house says its notices through Snapcast (house-speech.ts), as a WAV: for
 * «Escuchar» in Ajustes → Casa → «Voz de la casa». With `voice` (and its `speaker`), in that one.
 * The voice satellites are Seilide's (#329), with their own.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!piperEnabled) error(404, 'No hay Piper (PIPER_URL)');
	const body = await request.json().catch(() => null);
	const text = typeof body?.text === 'string' ? body.text.trim() : '';
	if (!text) error(400, 'Falta el texto');
	if (text.length > MAX_CHARS) error(413, 'Demasiado largo');
	try {
		const asked = { voice: body.voice, speaker: body.speaker ?? null };
		const wav = await houseSpeech(text, { voice: isPiperVoice(asked) ? asked : undefined });
		return new Response(wav, { headers: { 'content-type': 'audio/wav' } });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.error('voz', message);
		error(503, message);
	}
};
