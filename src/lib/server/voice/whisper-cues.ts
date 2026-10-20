import type { Cue } from '#lib/vtt.ts';

/**
 * Whisper times phrases, not words: with laughter, music or quick talk it starts them up to a few
 * seconds early, often on whole seconds (#86). With `-dtw` its server also times each word against
 * the audio (`t_dtw`, in hundredths of a second): a phrase starts at its first word, a little
 * before, as subtitles do. Measured against real subtitles, its first word is about 0.45 s late.
 */
const LEAD_SEC = 0.45;
/** At least this long on screen: less is hard to read. */
const MIN_SEC = 1;
/** How fast it can be read: characters a second, a little under what a native reads comfortably. */
const READ_CPS = 15;
/** Read alone, a phrase stays at least this long. */
const MIN_READ_SEC = 1.5;
/** The phrase before stays above the new one if it was said this little before the new one starts. */
const ROLL_GAP_SEC = 1;

export interface WhisperVerbose {
	segments: {
		start: number;
		end: number;
		text: string;
		words?: { word: string; t_dtw: number }[];
	}[];
}

/** Whisper marks noise and music between brackets, parentheses or notes: not words to read. */
export const spoken = (text: string) =>
	text
		.replace(/\[[^\]]*\]|\([^)]*\)|[♪♫]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

/**
 * The phrases of whisper-server's `verbose_json`, timed from the start of the audio. Without
 * `-dtw` (every `t_dtw` is -1), Whisper's own times, as before. They can overlap: `readableCues`.
 */
export function phrasesFromWhisper(body: WhisperVerbose): Cue[] {
	return body.segments.flatMap((segment) => {
		const text = spoken(segment.text);
		if (!text) return [];
		// A word with a letter or a number: not the «-» of a dialogue nor a comma.
		const first = segment.words?.find((w) => /[\p{L}\p{N}]/u.test(w.word) && w.t_dtw >= 0);
		const start = first ? Math.max(0, +(first.t_dtw / 100 - LEAD_SEC).toFixed(3)) : segment.start;
		return [{ start, end: Math.max(segment.end, +(start + MIN_SEC).toFixed(3)), text }];
	});
}

/** Until it can be read: its time saying it, or its reading time from when it starts. */
const readUntil = (phrase: Cue) =>
	Math.max(
		phrase.end,
		+(phrase.start + Math.max(MIN_READ_SEC, phrase.text.length / READ_CPS)).toFixed(3)
	);

/**
 * Phrases in order (a whole track's, so pieces' edges too) as subtitles that roll up, as the TV's
 * live ones and YouTube's (#86): the phrase being said at the bottom, the one before above it, so
 * each is on screen for about two phrases, not only while it is said; with quick talk there was no
 * time to read them. With nobody talking, the last one stays until it can be read, then goes.
 */
export function readableCues(phrases: Cue[]): Cue[] {
	const sorted = [...phrases].sort((a, b) => a.start - b.start);
	const cues: Cue[] = [];
	sorted.forEach((phrase, i) => {
		const next = sorted[i + 1];
		// Said at once with the next: that one shows both.
		if (next && next.start - phrase.start < 0.05) return;
		const before = sorted[i - 1];
		const above = before && phrase.start < readUntil(before) + ROLL_GAP_SEC;
		const until = readUntil(phrase);
		cues.push({
			start: phrase.start,
			// The next one rolls it up; without one soon, it goes once read.
			end: next && next.start < until ? next.start : until,
			text: above ? `${before.text}\n${phrase.text}` : phrase.text
		});
	});
	return cues;
}
