import { WAKE_WORDS, type WakeWordModel } from 'comun/wake-words.ts';

/**
 * Mensajes (#555): the AI is called by the family's wake word, as by voice: «@makoto busca…» anywhere,
 * or «Makoto, busca…» at the start. Then what is written goes to the AI's panel, not to anyone.
 * «@ia» works too, whatever the word.
 */

/** Its name: the wake word, without its greeting («hola casita», «Oye, Alizée», «Bonjour, Alizée»). */
export const assistantName = (word: WakeWordModel) =>
	word === 'hola_casita'
		? 'Casita'
		: word === 'oye_alizee' || word === 'bonjour_alizee'
			? 'Alizée'
			: WAKE_WORDS[word];

/** How it is written after «@»: «makoto». */
export const handleOf = (name: string) =>
	name
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '');

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What is asked of the AI, without its name; null if the text is not for it. */
export function askedOf(text: string, name: string): string | null {
	const handle = handleOf(name);
	// With its accents or without: «@alizée», «@alizee».
	const either = `${escape(name)}|${escape(handle)}`;
	const at = new RegExp(`(^|\\s)@(${either}|ia)(?![\\p{L}\\p{N}])[,:]?`, 'iu');
	if (at.test(text)) return text.replace(at, '$1').replace(/\s+/g, ' ').trim();
	const start = new RegExp(`^\\s*(?:${either})\\s*[,:]\\s*`, 'iu');
	if (start.test(text)) return text.replace(start, '').trim();
	return null;
}

/** «@mak» being written, at the end: the text with the name finished; null if not that. */
export function completed(text: string, name: string): string | null {
	const m = text.match(/(^|\s)@([\p{L}\p{N}]*)$/u);
	if (!m) return null;
	const handle = handleOf(name);
	const typed = handleOf(m[2]!);
	if (!handle.startsWith(typed) || typed === handle) return null;
	return `${text.slice(0, text.length - m[2]!.length)}${handle} `;
}
