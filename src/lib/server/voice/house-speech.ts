import { log } from '#lib/server/log.ts';
import { houseVoice, piper, type PiperVoice } from '#lib/server/piper.ts';
import { aiSpeech } from '#lib/server/voice/ai-voice.ts';
import { withChime } from 'comun/chime.ts';
import { getVoiceLevels } from '#lib/server/voice/levels.ts';
import { louder } from 'comun/wav.ts';
import { DEFAULT_TONE } from '#lib/voice-fillers.ts';
import { piperStyle } from '#lib/voice-levels.ts';

/**
 * What the house says aloud (#223, #241): a satellite's answer, or an alarm's words. As the house
 * chose in Ajustes → Casa: in Piper's voice, read its way («Expresividad», «Velocidad»), or in the
 * AI voice («Respuestas con»); as loud as «Volumen de la voz»; with `chime`, a timer's «din-don»
 * before it (chime.ts), as one sound. `voice`, that Piper voice instead («Escuchar» in Ajustes).
 */
export async function houseSpeech(
	text: string,
	{ chime = false, voice }: { chime?: boolean; voice?: PiperVoice } = {}
) {
	const levels = await getVoiceLevels();
	const said =
		(levels.aiAnswers && !voice && (await inAiVoice(text))) ||
		(await piper(text, 'es', voice ?? (await houseVoice()), piperStyle(levels)));
	// The «din-don» as it is, not louder.
	const loud = louder(said, levels.gainDb);
	return chime ? withChime(loud) : loud;
}

/**
 * The last ones in the AI voice, by their text: a ringing alarm says the same every few seconds,
 * and each would be paid and waited for again.
 */
const aiSaid = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();
const KEEP_SAID = 20;
/** Longer than this, Piper says it: someone is waiting. Its 2–4 s, with room (2026-10-27). */
const AI_TIMEOUT_MS = 10_000;

/** In the AI voice; null if it failed, for Piper to say it. */
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
