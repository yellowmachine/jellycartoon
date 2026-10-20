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
/** Two phrases in one cue, a line each, if they are no longer than this together. */
const MAX_CHARS = 80;

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

/**
 * Phrases in order (a whole track's, so pieces' edges too) as subtitles: never two at once, as
 * they would be shown one above the other, so the one before goes when the next comes. If that
 * leaves it too short to read, both in one cue, a line each, as subtitles do with quick dialogue:
 * from when the first is said to when the second ends.
 */
export function readableCues(phrases: Cue[]): Cue[] {
	const cues: Cue[] = [];
	for (const phrase of phrases) {
		const last = cues.at(-1);
		if (!last || phrase.start >= last.end) {
			cues.push(phrase);
			continue;
		}
		const fits = !last.text.includes('\n') && last.text.length + phrase.text.length <= MAX_CHARS;
		if (phrase.start - last.start < MIN_SEC && fits) {
			cues[cues.length - 1] = {
				start: last.start,
				end: Math.max(last.end, phrase.end),
				text: `${last.text}\n${phrase.text}`
			};
			continue;
		}
		// Too long for one cue: the next one waits until the one before has been on screen enough.
		const start = Math.max(phrase.start, +(last.start + MIN_SEC).toFixed(3));
		cues[cues.length - 1] = { ...last, end: start };
		cues.push({ ...phrase, start, end: Math.max(phrase.end, +(start + MIN_SEC).toFixed(3)) });
	}
	return cues;
}
