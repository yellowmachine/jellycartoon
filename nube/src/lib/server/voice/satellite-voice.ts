import {
	AI_VOICE,
	DEFAULT_TONE,
	isAiVoice,
	MAX_TONE_CHARS,
	parseFillers,
	pickFiller
} from 'comun/ai-voice.ts';
import { writeWav } from 'comun/wav.ts';
import { createHash } from 'node:crypto';
import { familySettings } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { sayableError, speech } from '#lib/server/openrouter.ts';
import { satellitesChanged } from '#lib/server/satellites.ts';
import { listFiles, putFile, readFile, removeFile, storageReady } from '#lib/server/storage.ts';

/**
 * How the satellites Seilide serves speak (#296), chosen in Ajustes → Familia: one of Gemini's
 * voices (Kore by default, as the house's), how it says things, and the phrases said while the AI
 * thinks. Said through OpenRouter with the family's key, and kept in memory by voice, tone and
 * text: a ringing alarm says the same every few seconds, and the phrases are the same ones.
 */

export interface SatelliteVoice {
	voice: string;
	tone: string;
	/** As saved: none, the default ones. */
	fillers: string[];
}

export async function satelliteVoiceOf(k: Kitchen): Promise<SatelliteVoice> {
	const [row] = await k.run((tx) =>
		tx.select({ saved: familySettings.satelliteVoice }).from(familySettings)
	);
	const saved = row?.saved;
	return {
		voice: isAiVoice(saved?.voice) ? saved.voice : AI_VOICE.voice,
		tone: saved?.tone?.trim() || DEFAULT_TONE,
		fillers: parseFillers((saved?.fillers ?? []).join('\n'))
	};
}

/**
 * Which voice it is, in a few letters (its voice and tone): told to the satellites with their
 * notices, for them to record their own phrases again only when it changes.
 */
export const voiceKey = (voice: SatelliteVoice) => hash(`${voice.voice}|${voice.tone}`);

/** Saved; an empty tone or no phrases, the default ones. Their recordings, made meanwhile. */
export async function setSatelliteVoice(
	k: Kitchen,
	apiKey: string | null,
	input: { voice: string; tone: string; fillers: string }
) {
	const set = {
		satelliteVoice: {
			voice: isAiVoice(input.voice) ? input.voice : AI_VOICE.voice,
			tone: input.tone.trim().slice(0, MAX_TONE_CHARS),
			fillers: parseFillers(input.fillers, { orDefault: false })
		}
	};
	await k.run((tx) =>
		tx
			.insert(familySettings)
			.values({ familyId: k.familyId, ...set })
			.onConflictDoUpdate({ target: familySettings.familyId, set })
	);
	await forgetGonePhrases(k);
	// The satellites, at once: their own phrases, in the new voice.
	await satellitesChanged(k.familyId);
	if (apiKey) await startFillers(k, apiKey);
}

/**
 * Where a phrase is kept, in the family's files: by its text, then voice and tone. Each voice's
 * kept (#301): going back to one is at once, and free; a phrase taken out, all of its voices out.
 */
const PHRASES = 'frases-espera';
const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);
const phraseFile = (voice: SatelliteVoice, text: string) =>
	`${hash(text)}-${hash(`${voice.voice}|${voice.tone}`)}.wav`;

/** Those of phrases no longer there (and the ones named as before v2.16.4, by all in one). */
async function forgetGonePhrases(k: Kitchen) {
	if (!storageReady) return;
	try {
		const texts = new Set((await satelliteVoiceOf(k)).fillers.map(hash));
		for (const name of await listFiles(k.familyId, PHRASES))
			if (!texts.has(name.split('-')[0])) await forgetPhrase(k, name);
	} catch (err) {
		console.warn('[voz] No se pudieron borrar las frases de espera viejas', String(err));
	}
}

/** Its recording, if kept; null without one (or without storage, or failing: recorded again). */
async function storedPhrase(k: Kitchen, voice: SatelliteVoice, text: string) {
	if (!storageReady) return null;
	try {
		return await readFile(k.familyId, PHRASES, phraseFile(voice, text));
	} catch (err) {
		console.warn('[voz] No se pudo leer una frase de espera', String(err));
		return null;
	}
}

async function keepPhrase(k: Kitchen, voice: SatelliteVoice, text: string, wav: Uint8Array) {
	if (!storageReady) return;
	try {
		await putFile(k.familyId, PHRASES, phraseFile(voice, text), wav, 'audio/wav');
	} catch (err) {
		console.warn('[voz] No se pudo guardar una frase de espera', String(err));
	}
}

async function forgetPhrase(k: Kitchen, name: string) {
	if (!storageReady) return;
	await removeFile(k.familyId, PHRASES, name).catch(() => {});
}

/** The phrases that could not be recorded, by `saidKey`: why, said (until one is). */
const failed = new Map<string, string>();

/** Said, by family, voice, tone and text; `done` once it is there, to say it at once. */
const said = new Map<string, { wav: Promise<Uint8Array<ArrayBuffer>>; done: boolean }>();
const KEEP_SAID = 200;
/** Someone is waiting: Kore takes 2–4 s (2026-10-27), with room. */
const TIMEOUT_MS = 15_000;

/**
 * By family, what waits to be said, the answers before the phrases. OpenRouter counts what is in
 * flight against the credit: on 2026-10-30, with $1.87, a second voice at once was refused («would
 * exceed your available credits given your current in-flight requests»), so one at a time.
 */
const queues = new Map<
	string,
	{ busy: boolean; answers: (() => void)[]; phrases: (() => void)[] }
>();

function next(familyId: string) {
	const queue = queues.get(familyId)!;
	const job = queue.answers.shift() ?? queue.phrases.shift();
	queue.busy = Boolean(job);
	if (job) job();
	else queues.delete(familyId);
}

function inTurn<T>(familyId: string, answer: boolean, task: () => Promise<T>) {
	let queue = queues.get(familyId);
	if (!queue) queues.set(familyId, (queue = { busy: false, answers: [], phrases: [] }));
	return new Promise<T>((resolve, reject) => {
		(answer ? queue.answers : queue.phrases).push(() =>
			task()
				.then(resolve, reject)
				.finally(() => next(familyId))
		);
		if (!queue.busy) next(familyId);
	});
}

const saidKey = (k: Kitchen, voice: SatelliteVoice, text: string) =>
	`${k.familyId}|${voice.voice}|${voice.tone}|${text}`;

/** Through OpenRouter, in its turn. */
async function record(
	k: Kitchen,
	apiKey: string,
	voice: SatelliteVoice,
	text: string,
	answer: boolean
) {
	const { pcm, rate } = await inTurn(k.familyId, answer, () =>
		speech({
			apiKey,
			model: AI_VOICE.model,
			voice: voice.voice,
			input: text,
			instructions: voice.tone,
			timeoutMs: TIMEOUT_MS
		})
	);
	return writeWav(rate, 1, pcm);
}

/** An answer, recorded; a phrase, as kept, or recorded and kept. */
async function make(
	k: Kitchen,
	apiKey: string,
	voice: SatelliteVoice,
	text: string,
	answer: boolean
) {
	if (answer) return record(k, apiKey, voice, text, true);
	const stored = await storedPhrase(k, voice, text);
	if (stored) return stored;
	const key = saidKey(k, voice, text);
	try {
		const wav = await record(k, apiKey, voice, text, false);
		failed.delete(key);
		await keepPhrase(k, voice, text, wav);
		return wav;
	} catch (err) {
		failed.set(key, sayableError(err instanceof Error ? err.message : String(err)));
		throw err;
	}
}

function say(k: Kitchen, apiKey: string, voice: SatelliteVoice, text: string, answer: boolean) {
	const key = saidKey(k, voice, text);
	let entry = said.get(key);
	if (!entry) {
		const made = {
			done: false,
			wav: make(k, apiKey, voice, text, answer) as Promise<Uint8Array<ArrayBuffer>>
		};
		entry = made;
		said.set(key, made);
		made.wav.then(
			() => (made.done = true),
			() => said.delete(key)
		);
		for (const old of [...said.keys()].slice(0, -KEEP_SAID)) said.delete(old);
	}
	return entry;
}

/** `text` in the family's voice, as a WAV (or in `voice`, to try it in Ajustes). Throws, said. */
export async function satelliteSpeech(
	k: Kitchen,
	apiKey: string,
	text: string,
	voice?: SatelliteVoice
) {
	return say(k, apiKey, voice ?? (await satelliteVoiceOf(k)), text, true).wav;
}

/** The last one said, by family: not the same twice running. */
const lastFiller = new Map<string, string>();

/**
 * One of the family's phrases, if it is already recorded (here, or kept in its files): null if not
 * (they are recorded now, for the next time), as a phrase late is worse than none.
 */
export async function fillerSpeech(k: Kitchen, apiKey: string) {
	const voice = await satelliteVoiceOf(k);
	const text = pickFiller(voice.fillers, lastFiller.get(k.familyId) ?? null);
	if (!text) return null;
	lastFiller.set(k.familyId, text);
	const entry = said.get(saidKey(k, voice, text));
	if (entry?.done) return entry.wav;
	if (!entry) {
		const stored = await storedPhrase(k, voice, text);
		if (stored) {
			const wav = stored as Uint8Array<ArrayBuffer>;
			said.set(saidKey(k, voice, text), { wav: Promise.resolve(wav), done: true });
			return wav;
		}
	}
	void warmFillers(k, apiKey);
	return null;
}

/**
 * All of them being recorded, one by one (those kept, read): once this is back, `phrasesState`
 * says so; `done`, when they are.
 */
export async function startFillers(k: Kitchen, apiKey: string) {
	const voice = await satelliteVoiceOf(k);
	const all = voice.fillers.map((text) => say(k, apiKey, voice, text, false).wav);
	return { done: Promise.allSettled(all) };
}

/** All of them recorded beforehand, so that they sound at once: after choosing them. */
export async function warmFillers(k: Kitchen, apiKey: string) {
	await (
		await startFillers(k, apiKey)
	).done;
}

export type PhraseState = 'ready' | 'recording' | 'failed' | 'missing';

/**
 * How the family's phrases are, for Ajustes (#301): each one recorded (here, or kept in its
 * files), being recorded, failed (and why), or not yet.
 */
export async function phrasesState(k: Kitchen) {
	const voice = await satelliteVoiceOf(k);
	const kept = new Set(
		storageReady ? await listFiles(k.familyId, PHRASES).catch(() => [] as string[]) : []
	);
	return voice.fillers.map((text) => {
		const key = saidKey(k, voice, text);
		const entry = said.get(key);
		const state: PhraseState =
			entry?.done || kept.has(phraseFile(voice, text))
				? 'ready'
				: entry
					? 'recording'
					: failed.has(key)
						? 'failed'
						: 'missing';
		return { text, state, problem: state === 'failed' ? failed.get(key)! : null };
	});
}
