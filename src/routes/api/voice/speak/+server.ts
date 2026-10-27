import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { log } from '#lib/server/log.ts';
import { sayOnSnapcast, snapcastVoiceReady } from '#lib/server/music/snapcast.ts';
import { houseVoice, isPiperVoice, piper, piperEnabled } from '#lib/server/piper.ts';
import { fillerWav } from '#lib/server/voice-fillers.ts';
import { DEFAULT_TONE, MAX_FILLER_CHARS } from '#lib/voice-fillers.ts';
import { aiSpeech } from '#lib/server/voice/ai-voice.ts';
import { withChime } from '#lib/server/voice/chime.ts';
import { getVoiceLevels } from '#lib/server/voice/levels.ts';
import { louder } from '#lib/server/voice/wav.ts';
import { piperStyle } from '#lib/voice-levels.ts';

/** An answer is a sentence or three: more than this is not one. */
const MAX_CHARS = 1000;

/**
 * An answer read aloud by Piper, as a WAV: for the voice satellites (#223), which have no browser
 * to say it (the phone uses its own speechSynthesis), in the house's voice. With `voice` (and its
 * `speaker`), in that one: «Escuchar» in Ajustes → Casa. With `filler` instead of `text`, one of the
 * phrases said while the AI thinks («Vale»), already read or recorded, or that one if it is a text;
 * nothing (204) if there are none. A
 * satellite that answers through Snapcast (Ajustes) has it said there, and gets nothing (204) once
 * it has been heard (a filler, at once); if Snapcast fails, the WAV, to say it itself. With
 * `chime`, a timer's «din-don» before it (chime.ts), as one sound. The voice, read and as loud as
 * the house chose (Ajustes → Casa: «Expresividad», «Velocidad», «Volumen de la voz»), and in the AI
 * voice instead of Piper if it chose so («Respuestas con»).
 */
/**
 * The last answers in the AI voice, by their text: a timer's ringing says the same every few
 * seconds, and each would be paid and waited for again.
 */
const aiSaid = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();
const KEEP_SAID = 20;
/** Longer than this, Piper says it: someone is waiting. Its 2–4 s, with room (2026-10-27). */
const AI_TIMEOUT_MS = 10_000;

/** In the AI voice (Ajustes → Casa, «Respuestas con»); null if it failed, for Piper to say it. */
async function inAiVoice(text: string) {
	let wav = aiSaid.get(text);
	if (!wav) {
		wav = aiSpeech(text, DEFAULT_TONE, AI_TIMEOUT_MS);
		aiSaid.set(text, wav);
		wav.catch(() => aiSaid.delete(text));
		for (const old of [...aiSaid.keys()].slice(0, -KEEP_SAID)) aiSaid.delete(old);
	}
	try {
		return await wav;
	} catch (err) {
		log.warn('voz', 'La voz IA falló; lo dice Piper', { error: err });
		return null;
	}
}

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
		const levels = await getVoiceLevels();
		const said = filler
			? await fillerWav(which)
			: // A voice asked by name («Escuchar» in Ajustes) is Piper's.
				(levels.aiAnswers && !isPiperVoice(asked) && (await inAiVoice(text))) ||
				(await piper(
					text,
					'es',
					isPiperVoice(asked) ? asked : await houseVoice(),
					piperStyle(levels)
				));
		// The house's «Volumen de la voz»; the «din-don» as it is, not louder.
		const voice = said && louder(said, levels.gainDb);
		const wav = voice && body.chime === true ? withChime(voice) : voice;
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
