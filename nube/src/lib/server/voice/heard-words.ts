import { familyPeople } from '#lib/server/agenda/agenda.ts';
import { familyPlace } from '#lib/server/family-settings.ts';
import type { Kitchen } from '#lib/server/fridge.ts';

/**
 * The family's own words, for what is heard to write them as they are: where it lives («Dónde
 * vivís») and its people's names. On 2026-10-31 Whisper heard «Beled Rubio» for «Vélez Rubio».
 * Given to the house's Whisper with the audio (its /voz/oir, `?palabras=`), and to the AI that
 * learns from what is said (learn.ts).
 */

/** Whisper keeps only the end of its prompt, and the house puts its music's names before these. */
export const MAX_WORDS_CHARS = 200;

export async function familyWords(k: Kitchen) {
	const [place, people] = await Promise.all([familyPlace(k), familyPeople(k)]);
	const words = [...new Set([place?.name, ...people.map((p) => p.name)])]
		.map((w) => w?.trim())
		.filter((w): w is string => Boolean(w));
	let text = '';
	for (const w of words) {
		const next = text ? `${text}, ${w}` : w;
		if (next.length > MAX_WORDS_CHARS) break;
		text = next;
	}
	return text;
}

/** The house's path to hear, with them. */
export const heardPath = (words: string) =>
	words ? `/voz/oir?palabras=${encodeURIComponent(words)}` : '/voz/oir';
