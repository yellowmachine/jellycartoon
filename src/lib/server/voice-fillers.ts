import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getAppSetting, setAppSetting } from '#lib/server/app-settings.ts';
import { fillersDir } from '#lib/server/library/paths.ts';
import { log } from '#lib/server/log.ts';
import { speech } from '#lib/server/openrouter.ts';
import { houseVoice, piper, type PiperVoice } from '#lib/server/piper.ts';
import { getVoiceLevels } from '#lib/server/voice/levels.ts';
import { writeWav } from '#lib/server/voice/wav.ts';
import { parseFillers, pickFiller, type FillerRecording } from '#lib/voice-fillers.ts';
import { piperStyle } from '#lib/voice-levels.ts';

/**
 * What a voice satellite says while the AI thinks (#223): «Vale», «Un momento»… changeable in
 * Ajustes → Casa. Read by Piper once for each voice and kept, so that they sound at once; or, one by
 * one, recorded by an AI voice (Gemini's Kore, chosen by ear on 2026-10-27), kept as a file, with
 * more life than Piper's.
 */

/** The AI voice that records them, through OpenRouter, as the DJ's (music/dj.ts). */
const AI_VOICE = { model: 'google/gemini-3.8-flash-tts', voice: 'Kore' };

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

/** Those recorded by the AI voice, by their text. */
export async function getRecordings(): Promise<Record<string, FillerRecording>> {
	try {
		const saved = JSON.parse((await getAppSetting('voice_filler_recordings')) ?? '{}');
		return saved && typeof saved === 'object' ? saved : {};
	} catch {
		return {};
	}
}

async function setRecordings(recordings: Record<string, FillerRecording>) {
	const empty = !Object.keys(recordings).length;
	await setAppSetting('voice_filler_recordings', empty ? null : JSON.stringify(recordings));
}

/** By its text: the same phrase, the same file. */
const recordingFile = (text: string) =>
	path.join(fillersDir, `${createHash('sha256').update(text).digest('hex').slice(0, 32)}.wav`);

/** `null`, the default ones. The recordings of those no longer there, deleted. */
export async function setFillers(text: string | null) {
	const list = text === null ? null : parseFillers(text, { orDefault: false });
	await setAppSetting('voice_fillers', list?.length ? list.join('\n') : null);
	const kept = await getFillers();
	const recordings = await getRecordings();
	for (const gone of Object.keys(recordings).filter((t) => !kept.includes(t))) {
		delete recordings[gone];
		await rm(recordingFile(gone), { force: true });
	}
	await setRecordings(recordings);
	void warmFillers();
}

/** That phrase recorded by the AI voice, said as `tone` asks; throws, said for a person. */
export async function recordFiller(text: string, tone: string) {
	const { pcm, rate } = await speech({ ...AI_VOICE, input: text, instructions: tone });
	await mkdir(fillersDir, { recursive: true });
	await writeFile(recordingFile(text), writeWav(rate, 1, pcm));
	await setRecordings({
		...(await getRecordings()),
		[text]: { tone, at: new Date().toISOString() }
	});
}

/** Back to Piper's. */
export async function forgetFiller(text: string) {
	const recordings = await getRecordings();
	delete recordings[text];
	await setRecordings(recordings);
	await rm(recordingFile(text), { force: true });
}

/**
 * That one, or one of them not the last one said; null if there are none. Its recording if it has
 * one, else in the house's voice.
 */
export async function fillerWav(text?: string) {
	const chosen = text ?? pickFiller(await getFillers(), last);
	if (!chosen) return null;
	if (!text) last = chosen;
	if ((await getRecordings())[chosen]) {
		try {
			return new Uint8Array(await readFile(recordingFile(chosen)));
		} catch (err) {
			log.warn('voz', 'Falta la grabación de una frase de espera: la dice Piper', {
				text: chosen,
				error: err
			});
		}
	}
	return wav(await house(), chosen);
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
