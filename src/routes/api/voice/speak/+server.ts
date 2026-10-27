import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '#lib/server/log.ts';
import { sayOnSnapcast, snapcastVoiceReady } from '#lib/server/music/snapcast.ts';
import { isPiperVoice, piperEnabled } from '#lib/server/piper.ts';
import { fillerWav } from '#lib/server/voice-fillers.ts';
import { MAX_FILLER_CHARS } from '#lib/voice-fillers.ts';
import { withChime } from '#lib/server/voice/chime.ts';
import { houseSpeech } from '#lib/server/voice/house-speech.ts';
import { getVoiceLevels } from '#lib/server/voice/levels.ts';
import { louder } from '#lib/server/voice/wav.ts';

/** An answer is a sentence or three: more than this is not one. */
const MAX_CHARS = 1000;

/**
 * An answer read aloud by Piper, as a WAV: for the voice satellites (#223), which have no browser
 * to say it (the phone uses its own speechSynthesis), in the house's voice. With `voice` (and its
 * `speaker`), in that one: «Escuchar» in Ajustes → Casa. With `filler` instead of `text`, one of the
 * phrases said while the AI thinks («Vale»), already read or recorded, or that one if it is a text;
 * nothing (204) if there are none. A satellite that answers through Snapcast (Ajustes) has it said
 * there, and gets nothing (204) once it has been heard (a filler, at once); if Snapcast fails, the
 * WAV, to say it itself. With `chime`, a timer's «din-don» before it. Said as the house chose
 * (house-speech.ts).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!piperEnabled) error(404, 'No hay Piper (PIPER_URL)');
	const body = await request.json().catch(() => null);
	// One of them at random, or that one (Ajustes, to hear it).
	const which =
		typeof body?.filler === 'string' ? body.filler.trim().slice(0, MAX_FILLER_CHARS) : undefined;
	const filler = body?.filler === true || Boolean(which);
	const text = typeof body?.text === 'string' ? body.text.trim() : '';
	if (!text && !filler) error(400, 'Falta el texto');
	if (text.length > MAX_CHARS) error(413, 'Demasiado largo');
	try {
		const asked = { voice: body.voice, speaker: body.speaker ?? null };
		const chime = body.chime === true;
		let wav: Uint8Array<ArrayBuffer> | null;
		if (filler) {
			// Already read or recorded: only as loud as the house's voice.
			const said = await fillerWav(which);
			const loud = said && louder(said, (await getVoiceLevels()).gainDb);
			wav = loud && chime ? withChime(loud) : loud;
		} else
			wav = await houseSpeech(text, {
				chime,
				// A voice asked by name («Escuchar» in Ajustes) is Piper's.
				voice: isPiperVoice(asked) ? asked : undefined
			});
		if (!wav) return new Response(null, { status: 204 });
		const on = locals.satellite?.answerOn;
		if (on && snapcastVoiceReady()) {
			try {
				await sayOnSnapcast(wav, on, { filler });
				return new Response(null, { status: 204 });
			} catch (err) {
				log.warn('voz', 'No se pudo contestar por Snapcast', {
					satellite: locals.satellite?.name,
					error: err
				});
			}
		}
		return new Response(wav, { headers: { 'content-type': 'audio/wav' } });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.error('voz', message);
		error(503, message);
	}
};
