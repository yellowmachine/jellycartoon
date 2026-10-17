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
