import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SAID_NO_CREDIT } from '../../packages/comun/src/voice.ts';
import { speech } from './server.ts';
import { beep, play } from './sound.ts';

/**
 * What the satellite says when Seilide cannot (#296): without internet, without credit, or its
 * voice failing. Recorded by Seilide in the family's voice while it can, and kept on its own disk,
 * again every day (the voice may have been changed); before the first time, a low beep.
 */

const PHRASES = {
	offline: 'No tengo conexión con Seilide. Prueba dentro de un rato.',
	noCredit: SAID_NO_CREDIT,
	noVoice: 'Hecho, pero ahora no puedo hablar.'
} as const;

export type Fallback = keyof typeof PHRASES;

const DIR = process.env.FALLBACK_DIR ?? '/data/frases';
/** Once a day, in the voice the family has then. */
const REFRESH_MS = 24 * 60 * 60_000;

/** By its text: a new phrase, a new file. */
const fileOf = (text: string) =>
	path.join(DIR, `${createHash('sha256').update(text).digest('hex').slice(0, 16)}.wav`);

/** Each phrase, recorded now; one that fails stays as it was. Never fails. */
async function record() {
	await mkdir(DIR, { recursive: true }).catch(() => {});
	for (const text of Object.values(PHRASES))
		try {
			const wav = await speech(text);
			if (wav) await writeFile(fileOf(text), wav);
		} catch (err) {
			console.error(`Sin grabar «${text}»:`, err instanceof Error ? err.message : String(err));
		}
}

/** Recorded at start and then every day. */
export function keepFallbacks() {
	void record();
	setInterval(() => void record(), REFRESH_MS).unref();
}

/** That one said, as it was recorded; a low beep if it never was. */
export async function sayFallback(which: Fallback) {
	try {
		await play(new Uint8Array(await readFile(fileOf(PHRASES[which]))));
	} catch {
		await beep(440);
	}
}

/** The answer it could not have said: the credit's own phrase, or that it was done. */
export const fallbackFor = (reply: string): Fallback =>
	reply === SAID_NO_CREDIT ? 'noCredit' : 'noVoice';
