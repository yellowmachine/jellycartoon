import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '#lib/server/log.ts';
import { piper, piperEnabled } from '#lib/server/piper.ts';

/** An answer is a sentence or three: more than this is not one. */
const MAX_CHARS = 1000;

/**
 * An answer read aloud by Piper, as a WAV: for the voice satellites (#223), which have no browser
 * to say it (the phone uses its own speechSynthesis).
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!piperEnabled) error(404, 'No hay Piper (PIPER_URL)');
	const body = await request.json().catch(() => null);
	const text = typeof body?.text === 'string' ? body.text.trim() : '';
	if (!text) error(400, 'Falta el texto');
	if (text.length > MAX_CHARS) error(413, 'Demasiado largo');
	try {
		const wav = await piper(text);
		return new Response(wav, { headers: { 'content-type': 'audio/wav' } });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.error('voz', message);
		error(503, message);
	}
};
