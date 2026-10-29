import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { AI_VOICE, DEFAULT_TONE } from 'comun/ai-voice.ts';
import { withChime } from 'comun/chime.ts';
import { writeWav } from 'comun/wav.ts';
import { openRouterKey } from '#lib/server/family-settings.ts';
import { sayableError, speech } from '#lib/server/openrouter.ts';
import { satelliteRequest } from '#lib/server/satellites.ts';

/** An answer is a sentence or three: more than this is not one. */
const MAX_CHARS = 1000;
/** Someone is waiting: Kore takes 2–4 s (2026-10-27), with room. */
const TIMEOUT_MS = 15_000;
/**
 * The last ones said, by their family and text: a ringing alarm says the same every few seconds,
 * and each would be paid and waited for again.
 */
const said = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();
const KEEP_SAID = 50;

/**
 * An answer read aloud for a satellite of Seilide's (#296), the house's path (its
 * /api/voice/speak): as a WAV, in the AI voice (Kore), with the family's key; with `chime`, a
 * timer's «din-don» before it. The phrases said while the AI thinks (`filler`) are not here yet:
 * nothing (204), as a house with none.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { k } = await satelliteRequest(request);
	const body = await request.json().catch(() => null);
	if (body?.filler) return new Response(null, { status: 204 });
	const text = typeof body?.text === 'string' ? body.text.trim() : '';
	if (!text) error(400, 'Falta el texto');
	if (text.length > MAX_CHARS) error(413, 'Demasiado largo');
	const apiKey = await openRouterKey(k);
	if (!apiKey) error(503, 'La familia no tiene clave de IA: ponla en Ajustes de Seilide');
	const key = `${k.familyId}:${text}`;
	let wav = said.get(key);
	if (!wav) {
		wav = speech({
			apiKey,
			...AI_VOICE,
			input: text,
			instructions: DEFAULT_TONE,
			timeoutMs: TIMEOUT_MS
		}).then(({ pcm, rate }) => writeWav(rate, 1, pcm));
		said.set(key, wav);
		wav.catch(() => said.delete(key));
		for (const old of [...said.keys()].slice(0, -KEEP_SAID)) said.delete(old);
	}
	try {
		const voice = await wav;
		return new Response(body.chime === true ? withChime(voice) : voice, {
			headers: { 'content-type': 'audio/wav' }
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[voz] Al decirlo: ${message}`, { familyId: k.familyId });
		error(503, sayableError(message));
	}
};
