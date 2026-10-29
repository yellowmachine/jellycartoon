import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '#lib/server/log.ts';
import { fromCloud } from '#lib/server/media-api.ts';
import { transcribe, voiceEnabled } from '#lib/server/voice/whisper.ts';

/** An order is a few seconds: more than this is not one. */
const MAX_BYTES = 5_000_000;

/**
 * What was recorded in the cloud (#253: its road mode's microphone), as it is: the text that was
 * said, by the house's Whisper, which knows its music's names.
 */
export const POST: RequestHandler = async ({ request }) => {
	await fromCloud(request);
	if (!voiceEnabled) error(404, 'No hay voz configurada (WHISPER_URL)');
	const audio = await request.blob();
	if (!audio.size) error(400, 'No llegó audio');
	if (audio.size > MAX_BYTES) error(413, 'Demasiado largo');
	try {
		const started = performance.now();
		const text = await transcribe(audio);
		log.info('voz', `Transcrito para Seilide en ${Math.round(performance.now() - started)} ms`, {
			bytes: audio.size
		});
		return json({ text });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.error('voz', message);
		error(503, message);
	}
};
