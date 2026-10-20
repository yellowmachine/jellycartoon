import type { Cue } from '#lib/vtt.ts';

/**
 * Whisper times phrases, not words: with laughter, music or quick talk it starts them up to a few
 * seconds early, often on whole seconds (#86). With `-dtw` its server also times each word against
 * the audio (`t_dtw`, in hundredths of a second): a phrase starts at its first word, a little
 * before, as subtitles do. Measured against real subtitles, its first word is about 0.45 s late.
 */
const LEAD_SEC = 0.45;
/** At least this long on screen, if its first word comes near its end. */
const MIN_SEC = 1;

export interface WhisperVerbose {
	segments: {
		start: number;
		end: number;
		text: string;
		words?: { word: string; t_dtw: number }[];
	}[];
}

/**
 * The phrases of whisper-server's `verbose_json`, timed from the start of the audio. Without
 * `-dtw` (every `t_dtw` is -1), Whisper's own times, as before.
 */
export function cuesFromWhisper(body: WhisperVerbose): Cue[] {
	const cues = body.segments.flatMap((segment) => {
		const text = segment.text.trim();
		if (!text) return [];
		// A word with a letter or a number: not the «-» of a dialogue nor a comma.
		const first = segment.words?.find((w) => /[\p{L}\p{N}]/u.test(w.word) && w.t_dtw >= 0);
		const start = first ? Math.max(0, +(first.t_dtw / 100 - LEAD_SEC).toFixed(3)) : segment.start;
		return [{ start, end: Math.max(segment.end, +(start + MIN_SEC).toFixed(3)), text }];
	});
	// Gone when the next one comes: two at once would be shown one above the other.
	return cues.map((cue, i) => {
		const next = cues[i + 1];
		return next && next.start > cue.start && next.start < cue.end
			? { ...cue, end: next.start }
			: cue;
	});
}
