/**
 * The AI voice of the satellites (#223): Gemini's Kore through OpenRouter, chosen by ear on
 * 2026-10-27, and how it says things unless told otherwise; and the phrases said while the AI
 * thinks. The house's (its ai-voice.ts, also the DJ's) and Seilide's (#296), for the satellites it
 * serves.
 */
export const AI_VOICE = { model: 'google/gemini-3.8-flash-tts', voice: 'Kore' };

export const DEFAULT_TONE =
	'Mujer joven argentina, acento rioplatense de Buenos Aires. Cercana y natural, como una asistente de casa que se pone a hacer lo que le piden. Corto, sin exagerar.';

/**
 * Gemini's voices that can be chosen in Seilide (Ajustes → Familia), Kore first: a few, each with
 * how it sounds, as Google describes them (https://ai.google.dev/gemini-api/docs/speech-generation).
 */
export const AI_VOICES = [
	{ id: 'Kore', label: 'Kore (firme)' },
	{ id: 'Leda', label: 'Leda (juvenil)' },
	{ id: 'Aoede', label: 'Aoede (ligera)' },
	{ id: 'Puck', label: 'Puck (animado)' },
	{ id: 'Charon', label: 'Charon (informativo)' },
	{ id: 'Fenrir', label: 'Fenrir (con energía)' }
] as const;

export const isAiVoice = (value: unknown): value is (typeof AI_VOICES)[number]['id'] =>
	AI_VOICES.some((v) => v.id === value);

/** Gemini's lighter speech model: the same voices, faster (1.8 s against 2.5, 2026-10-31). */
const GEMINI_LITE = 'google/gemini-3.8-flash-lite-tts';

/**
 * The voices Seilide's satellites can speak with (Ajustes → Familia, #347): through OpenRouter's
 * /audio/speech, with the family's key, each by its model. Gemini's, by their name, as saved
 * before (Kore, the default); the others, chosen by ear on 2026-10-31, faster, and by their
 * provider (`eleven:jessica`). `tone`: whether it takes «Cómo habla» (only Gemini's, as far as is
 * known). `fast`: an answer said in under a second or so, measured that day.
 */
export const SATELLITE_VOICES = [
	{
		id: 'eleven:jessica',
		model: 'elevenlabs/eleven-flash-v2.5',
		voice: 'jessica',
		label: 'Jessica · ElevenLabs',
		tone: false,
		fast: true
	},
	{
		id: 'eleven-v3:sarah',
		model: 'elevenlabs/eleven-v3-conversational',
		voice: 'sarah',
		label: 'Sarah · ElevenLabs v3',
		tone: false,
		fast: true
	},
	{
		id: 'grok:eve',
		model: 'x-ai/grok-voice-tts-1.0',
		voice: 'eve',
		label: 'Eve · Grok',
		tone: false,
		fast: true
	},
	{
		id: 'grok:ara',
		model: 'x-ai/grok-voice-tts-1.0',
		voice: 'ara',
		label: 'Ara · Grok',
		tone: false,
		fast: true
	},
	{
		id: 'mai:marta',
		model: 'microsoft/mai-voice-2.1-flash',
		voice: 'es-ES-Marta:MAI-Voice-2.1-Flash',
		label: 'Marta (España) · Microsoft',
		tone: false,
		fast: true
	},
	{
		id: 'mai:valeria',
		model: 'microsoft/mai-voice-2.1-flash',
		voice: 'es-MX-Valeria:MAI-Voice-2.1-Flash',
		label: 'Valeria (México) · Microsoft',
		tone: false,
		fast: true
	},
	...AI_VOICES.map((v) => ({
		id: v.id,
		model: GEMINI_LITE,
		voice: v.id,
		label: v.label,
		tone: true,
		fast: false
	}))
] as const satisfies readonly {
	id: string;
	model: string;
	voice: string;
	label: string;
	tone: boolean;
	fast: boolean;
}[];

export type SatelliteVoiceId = (typeof SATELLITE_VOICES)[number]['id'];

export const isSatelliteVoice = (value: unknown): value is SatelliteVoiceId =>
	SATELLITE_VOICES.some((v) => v.id === value);

/** Its model and voice for OpenRouter; an unknown one, the default (Kore). */
export function satelliteVoiceModel(id: string) {
	return (
		SATELLITE_VOICES.find((v) => v.id === id) ??
		SATELLITE_VOICES.find((v) => v.id === AI_VOICE.voice)!
	);
}

export const MAX_TONE_CHARS = 300;

/** What a satellite says while the AI thinks: short, they fill a wait, they are not an answer. */
export const DEFAULT_FILLERS = [
	'Vale.',
	'Un momento.',
	'Ahora mismo.',
	'Dame un segundo.',
	'Me pongo con ello.'
];
export const MAX_FILLERS = 20;
export const MAX_FILLER_CHARS = 60;

/** The saved lines, trimmed, without repeats; the default ones if there are none (and `orDefault`). */
export function parseFillers(text: string | null, { orDefault = true } = {}) {
	const list = [
		...new Set(
			(text ?? '')
				.split('\n')
				.map((line) => line.trim().slice(0, MAX_FILLER_CHARS))
				.filter(Boolean)
		)
	].slice(0, MAX_FILLERS);
	return list.length || !orDefault ? list : DEFAULT_FILLERS;
}

/** One at random, not the same as the last time when there are more. */
export function pickFiller(list: string[], last: string | null, random = Math.random) {
	const choices = list.length > 1 ? list.filter((f) => f !== last) : list;
	return choices[Math.floor(random() * choices.length)] ?? null;
}
