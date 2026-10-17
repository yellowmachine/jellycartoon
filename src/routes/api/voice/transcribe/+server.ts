import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '#lib/server/log.ts';
import { transcribe, voiceEnabled } from '#lib/server/voice/whisper.ts';

/** An order is a few seconds: more than this is not one. */
const MAX_BYTES = 5_000_000;

/** What the browser recorded while the button was held, as it is: the text that was said. */
export const POST: RequestHandler = async ({ request }) => {
	if (!voiceEnabled) error(404, 'No hay voz configurada (WHISPER_URL)');
	const audio = await request.blob();
	if (!audio.size) error(400, 'No llegó audio');
	if (audio.size > MAX_BYTES) error(413, 'Demasiado largo');
	try {
		const started = performance.now();
		const text = await transcribe(audio);
		log.info('voz', `Transcrito en ${Math.round(performance.now() - started)} ms`, {
			bytes: audio.size,
			type: audio.type
		});
		return json({ text });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.error('voz', message);
		error(503, message);
	}
};
