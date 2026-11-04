import { createHash } from 'node:crypto';
import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SAID_KEY_EXPIRED, SAID_NO_CREDIT } from '../../packages/comun/src/voice.ts';
import { ServerError, speech } from './server.ts';
import { beep, play } from './sound.ts';

/**
 * What the satellite says when Seilide cannot (#296): without internet, without credit, or its
 * voice failing. Recorded by Seilide in the family's voice while it can, and kept on its own disk;
 * again only when the family's voice changes (Seilide tells which it is with the notices) or one is
 * missing, not at every start; before the first time, a low beep. And, if the family wants, what
 * it says on hearing its word instead of the beep (`greetings`, Ajustes): recorded the same way,
 * and kept in memory too, to be said at once.
 */

const PHRASES = {
	offline: 'No tengo conexión con Seilide. Prueba dentro de un rato.',
	noCredit: SAID_NO_CREDIT,
	keyExpired: SAID_KEY_EXPIRED,
	noVoice: 'Hecho, pero ahora no puedo hablar.',
	/** Its answer did nothing (a question, the time): not «hecho». */
	noVoiceNothingDone: 'Ahora no puedo hablar. Prueba dentro de un rato.'
} as const;

export type Fallback = keyof typeof PHRASES;

const DIR = process.env.FALLBACK_DIR ?? '/data/frases';
/** Which voice they were recorded in, as Seilide told it. */
const VOICE_FILE = path.join(DIR, 'voz.txt');

/** By its text: a new phrase, a new file. */
const fileOf = (text: string) =>
	path.join(DIR, `${createHash('sha256').update(text).digest('hex').slice(0, 16)}.wav`);

const exists = (file: string) =>
	access(file).then(
		() => true,
		() => false
	);

/** What it says on hearing its word, as Seilide told it; and those recorded, in memory. */
let greetings: string[] = [];
const greetingWavs = new Map<string, Uint8Array>();

/**
 * Each phrase that has to be recorded, recorded now: all of them in a new voice, or only those
 * missing. One that fails stays as it was, and the voice is not marked: tried again next time.
 * Those no longer said (a greeting taken out), deleted. Never fails.
 */
async function record(all: boolean, voice: string | null) {
	await mkdir(DIR, { recursive: true }).catch(() => {});
	let failed = false;
	const texts = [...Object.values(PHRASES), ...greetings];
	for (const text of texts) {
		if (!all && (await exists(fileOf(text)))) continue;
		try {
			const wav = await speech(text);
			if (wav) await writeFile(fileOf(text), wav);
		} catch (err) {
			failed = true;
			console.error(`Sin grabar «${text}»:`, err instanceof Error ? err.message : String(err));
		}
	}
	const kept = new Set(texts.map((t) => path.basename(fileOf(t))));
	for (const name of await readdir(DIR).catch(() => [] as string[]))
		if (name.endsWith('.wav') && !kept.has(name)) await rm(path.join(DIR, name)).catch(() => {});
	greetingWavs.clear();
	for (const text of greetings) {
		const wav = await readFile(fileOf(text)).catch(() => null);
		if (wav) greetingWavs.set(text, new Uint8Array(wav));
	}
	if (voice && !failed) await writeFile(VOICE_FILE, voice).catch(() => {});
}

let recording = false;
/** Asked again while recording: once more after it, with what was asked last. */
let again: { voice: string | null; greetings: string[] } | null = null;

/**
 * With each state of its notices: `voice`, the family's voice as Seilide tells it (none, a
 * house's): recorded again if it is not the one they were recorded in; else only those missing.
 * `said`, what it says on hearing its word (none, the beep).
 */
export async function keepFallbacks(voice: string | null, said: string[] = []) {
	if (recording) {
		again = { voice, greetings: said };
		return;
	}
	recording = true;
	greetings = said;
	try {
		const recordedIn = await readFile(VOICE_FILE, 'utf8').catch(() => null);
		await record(Boolean(voice) && recordedIn?.trim() !== voice, voice);
	} finally {
		recording = false;
	}
	if (again) {
		const next = again;
		again = null;
		await keepFallbacks(next.voice, next.greetings);
	}
}

let lastGreeting: string | null = null;

/**
 * One of them, recorded, at random and not the same twice running: null if none is (yet), and the
 * beep then.
 */
export function greeting(): Uint8Array | null {
	const ready = greetings.filter((t) => greetingWavs.has(t));
	const choices = ready.length > 1 ? ready.filter((t) => t !== lastGreeting) : ready;
	const text = choices[Math.floor(Math.random() * choices.length)];
	if (!text) return null;
	lastGreeting = text;
	return greetingWavs.get(text)!;
}

/** That one said, as it was recorded; a low beep if it never was. */
export async function sayFallback(which: Fallback) {
	try {
		await play(new Uint8Array(await readFile(fileOf(PHRASES[which]))));
	} catch {
		await beep(440);
	}
}

/**
 * The answer it could not have said: the credit's own phrase (its answer, or its voice, without
 * credit: a 402), the expired key's (Seilide's words, in the answer or in its voice's no), or
 * whether something was done.
 */
export function fallbackFor(reply: string, actions: number, err: unknown): Fallback {
	if (reply === SAID_NO_CREDIT || (err instanceof ServerError && err.status === 402))
		return 'noCredit';
	if (
		reply === SAID_KEY_EXPIRED ||
		(err instanceof ServerError && err.message.includes(SAID_KEY_EXPIRED))
	)
		return 'keyExpired';
	return actions ? 'noVoice' : 'noVoiceNothingDone';
}
