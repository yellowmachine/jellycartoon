/**
 * What whisper says, without what is not words: it marks silence and noise between brackets or
 * parentheses, e.g. `[BLANK_AUDIO]` or `(música)`.
 */
export function cleanTranscript(text: string) {
	return text
		.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** The family's own words Seilide sends (its heard-words.ts), at most: the rest is the library's. */
export const MAX_FAMILY_WORDS = 200;

/**
 * Whisper's prompt: the library's artists and, last, the family's own words (where it lives, its
 * people), as Whisper keeps the end of it; in `most` characters, the library's cut by whole names.
 * On 2026-10-31 it heard «Beled Rubio» for «Vélez Rubio».
 */
export function whisperPrompt(library: string, familyWords: string, most: number) {
	const words = familyWords.replace(/\s+/g, ' ').trim().slice(0, MAX_FAMILY_WORDS);
	if (!words) return library;
	const room = most - words.length - ' En casa: .'.length;
	let head = library;
	if (head.length > room) {
		const cut = head.slice(0, room);
		head = `${cut.slice(0, Math.max(cut.lastIndexOf(','), 0))}.`;
	}
	return `${head && head !== '.' ? `${head} ` : ''}En casa: ${words}.`;
}
