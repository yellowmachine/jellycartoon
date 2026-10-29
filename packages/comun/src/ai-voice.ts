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
