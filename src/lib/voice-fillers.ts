/**
 * What a voice satellite says while the AI thinks (#223), one a line in Ajustes → Casa. Short: they
 * fill a wait, they are not an answer.
 */

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
