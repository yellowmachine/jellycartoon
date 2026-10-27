import { getAppSetting, setAppSetting } from '#lib/server/app-settings.ts';
import { log } from '#lib/server/log.ts';
import { houseVoice, piper, type PiperVoice } from '#lib/server/piper.ts';
import { getVoiceLevels } from '#lib/server/voice/levels.ts';
import { parseFillers, pickFiller } from '#lib/voice-fillers.ts';
import { piperStyle } from '#lib/voice-levels.ts';

/**
 * What a voice satellite says while the AI thinks (#223): «Vale», «Un momento»… changeable in
 * Ajustes → Casa. Read by Piper once for each voice and kept, so that they sound at once.
 */

/**
 * Kept by voice, way of reading and text: a new voice, way or phrase is made the first time, the
 * rest are there.
 */
const made = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();
let last: string | null = null;

type Style = ReturnType<typeof piperStyle>;

const key = (voice: PiperVoice, style: Style, text: string) =>
	`${voice.voice}|${voice.speaker ?? ''}|${JSON.stringify(style)}|${text}`;

/** The house's voice and its way of reading (Ajustes → Casa). */
async function house() {
	return { voice: await houseVoice(), style: piperStyle(await getVoiceLevels()) };
}

function wav({ voice, style }: { voice: PiperVoice; style: Style }, text: string) {
	const k = key(voice, style, text);
	let wav = made.get(k);
	if (!wav) {
		wav = piper(text, 'es', voice, style);
		made.set(k, wav);
		// Not kept if it failed: tried again the next time.
		wav.catch(() => made.delete(k));
	}
	return wav;
}

export async function getFillers() {
	return parseFillers(await getAppSetting('voice_fillers'));
}

/** `null`, the default ones. */
export async function setFillers(text: string | null) {
	const list = text === null ? null : parseFillers(text, { orDefault: false });
	await setAppSetting('voice_fillers', list?.length ? list.join('\n') : null);
	void warmFillers();
}

/** One of them in the house's voice, not the last one said; null if there are none. */
export async function fillerWav() {
	const text = pickFiller(await getFillers(), last);
	if (!text) return null;
	last = text;
	return wav(await house(), text);
}

/**
 * All of them read beforehand, so that even the first sounds at once: after choosing them, the voice
 * or its way of reading.
 */
export async function warmFillers() {
	try {
		const voice = await house();
		await Promise.all((await getFillers()).map((text) => wav(voice, text)));
	} catch (err) {
		log.warn('voz', 'No se pudieron preparar las frases de espera', { error: err });
	}
}
