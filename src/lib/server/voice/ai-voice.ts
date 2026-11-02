import { log } from '#lib/server/log.ts';
import { speech } from '#lib/server/openrouter.ts';
import { AI_VOICE } from 'comun/ai-voice.ts';
import { writeWav } from 'comun/wav.ts';

/**
 * The house's AI voice: Gemini's Kore through OpenRouter, as the DJ's (music/dj.ts), chosen by ear
 * on 2026-10-27. If the house chooses it (Ajustes → Casa, «Dicho con»), for its notices instead
 * of Piper: about 2.6 s more each (measured that day), against Piper's tenth of a second.
 */

/**
 * As a WAV; throws, said for a person. `tone`, how it says it (accent, mood); `timeoutMs`, how long
 * someone can wait for it (OpenRouter's minute by default).
 */
export async function aiSpeech(text: string, tone: string, timeoutMs?: number) {
	const started = performance.now();
	const { pcm, rate } = await speech({ ...AI_VOICE, input: text, instructions: tone, timeoutMs });
	log.info('voz', `Voz IA: ${Math.round(performance.now() - started)} ms`, {
		chars: text.length
	});
	return writeWav(rate, 1, pcm);
}
