import {
	AI_VOICE,
	DEFAULT_TONE,
	isAiVoice,
	MAX_TONE_CHARS,
	parseFillers,
	pickFiller
} from 'comun/ai-voice.ts';
import { writeWav } from 'comun/wav.ts';
import { familySettings } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { speech } from '#lib/server/openrouter.ts';

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
	if (apiKey) void warmFillers(k, apiKey);
}

/** Said, by family, voice, tone and text; `done` once it is there, to say it at once. */
const said = new Map<string, { wav: Promise<Uint8Array<ArrayBuffer>>; done: boolean }>();
const KEEP_SAID = 200;
/** Someone is waiting: Kore takes 2–4 s (2026-10-27), with room. */
const TIMEOUT_MS = 15_000;

function say(k: Kitchen, apiKey: string, voice: SatelliteVoice, text: string) {
	const key = `${k.familyId}|${voice.voice}|${voice.tone}|${text}`;
	let entry = said.get(key);
	if (!entry) {
		const made = {
			done: false,
			wav: speech({
				apiKey,
				model: AI_VOICE.model,
				voice: voice.voice,
				input: text,
				instructions: voice.tone,
				timeoutMs: TIMEOUT_MS
			}).then(({ pcm, rate }) => writeWav(rate, 1, pcm))
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
	return say(k, apiKey, voice ?? (await satelliteVoiceOf(k)), text).wav;
}

/** The last one said, by family: not the same twice running. */
const lastFiller = new Map<string, string>();

/**
 * One of the family's phrases, if it is already recorded: null if not (it is recorded now, for the
 * next time), as a phrase late is worse than none.
 */
export async function fillerSpeech(k: Kitchen, apiKey: string) {
	const voice = await satelliteVoiceOf(k);
	const text = pickFiller(voice.fillers, lastFiller.get(k.familyId) ?? null);
	if (!text) return null;
	lastFiller.set(k.familyId, text);
	const entry = say(k, apiKey, voice, text);
	if (!entry.done) {
		void warmFillers(k, apiKey);
		return null;
	}
	return entry.wav;
}

/** All of them recorded beforehand, so that they sound at once: after choosing them. */
export async function warmFillers(k: Kitchen, apiKey: string) {
	const voice = await satelliteVoiceOf(k);
	await Promise.allSettled(voice.fillers.map((text) => say(k, apiKey, voice, text).wav));
}
