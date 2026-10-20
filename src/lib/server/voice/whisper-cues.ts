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
 * How the phrases are put on screen, chosen by each in «⚙ Estilo» (#86): with quick talk, a phrase
 * shown only while it is said could not be read, so two are on screen at once.
 * - `single`: one line, each phrase alone until the next (or until read, with nobody talking): for
 *   slow talk; with quick talk, a phrase may go before it is read.
 * - `blocks`: two lines that do not move; the second comes under the first, and then both go.
 * - `rollup`: the one being said at the bottom, the one before above it, as the TV's live ones.
 * - `rollupDim`: the same, the one before dimmed, so the eye finds the new one.
 */
export const SUBTITLE_FORMS = ['single', 'blocks', 'rollup', 'rollupDim'] as const;
export type SubtitleForm = (typeof SUBTITLE_FORMS)[number];

/** Said at once with the next one (a start this close): shown with it. */
const AT_ONCE_SEC = 0.05;

/** A cue showing `lines`, the last one the phrase just said; `previous` above it, rolled up. */
const cue = (start: number, end: number, text: string, previous?: string): Cue =>
	previous === undefined ? { start, end, text } : { start, end, text, previous };

/**
 * Phrases in order (a whole track's, so pieces' edges too) rolled up: each on screen for about
 * two phrases, not only while it is said. With nobody talking, the last one stays until it can be
 * read, then goes.
 */
function rollUp(sorted: Cue[]): Cue[] {
	const cues: Cue[] = [];
	sorted.forEach((phrase, i) => {
		const next = sorted[i + 1];
		if (next && next.start - phrase.start < AT_ONCE_SEC) return;
		const before = sorted[i - 1];
		const above = before && phrase.start < readUntil(before) + ROLL_GAP_SEC;
		const until = readUntil(phrase);
		// The next one rolls it up; without one soon, it goes once read.
		const end = next && next.start < until ? next.start : until;
		cues.push(cue(phrase.start, end, phrase.text, above ? before.text : undefined));
	});
	return cues;
}

/**
 * Phrases in blocks of two lines that do not move: the first alone, then the second under it, and
 * then the block goes for the next. A phrase after a pause starts a block of its own.
 */
function inBlocks(sorted: Cue[]): Cue[] {
	const cues: Cue[] = [];
	let i = 0;
	while (i < sorted.length) {
		const first = sorted[i]!;
		const second = sorted[i + 1];
		const paired = second && second.start < readUntil(first) + ROLL_GAP_SEC;
		if (!paired) {
			const until = readUntil(first);
			cues.push(
				cue(first.start, second && second.start < until ? second.start : until, first.text)
			);
			i += 1;
			continue;
		}
		const after = sorted[i + 2];
		if (second.start - first.start >= AT_ONCE_SEC)
			cues.push(cue(first.start, second.start, first.text));
		const until = Math.max(readUntil(first), readUntil(second));
		const end = after && after.start < until ? after.start : until;
		cues.push(cue(second.start, end, `${first.text}\n${second.text}`));
		i += 2;
	}
	return cues;
}

/** One at a time: each until the next comes, or until it can be read. */
function oneByOne(sorted: Cue[]): Cue[] {
	return sorted.flatMap((phrase, i) => {
		const next = sorted[i + 1];
		if (next && next.start - phrase.start < AT_ONCE_SEC) return [];
		const until = readUntil(phrase);
		return [cue(phrase.start, next && next.start < until ? next.start : until, phrase.text)];
	});
}

/** The phrases as subtitles, in the form chosen. */
export function formCues(phrases: Cue[], form: SubtitleForm): Cue[] {
	const sorted = [...phrases].sort((a, b) => a.start - b.start);
	if (form === 'single') return oneByOne(sorted);
	return form === 'blocks' ? inBlocks(sorted) : rollUp(sorted);
}

/**
 * The phrases back from a .vtt already made (#86), so its form can be chosen without making it
 * again: rolled up, each cue's last line is a phrase said then; two lines that were not rolled up
 * are two phrases (the second's start, not kept, halfway); one line, a phrase as it was.
 */
export function phrasesFromVtt(cues: Cue[]): Cue[] {
	const phrases: Cue[] = [];
	cues.forEach((c, i) => {
		const lines = c.text.split('\n').filter(Boolean);
		const before = cues[i - 1]?.text.split('\n').filter(Boolean).at(-1);
		if (lines.length === 2 && lines[0] === before) {
			phrases.push({ start: c.start, end: c.end, text: lines[1]! });
			return;
		}
		if (lines.length === 2) {
			const half = +((c.start + c.end) / 2).toFixed(3);
			phrases.push({ start: c.start, end: half, text: lines[0]! });
			phrases.push({ start: half, end: c.end, text: lines[1]! });
			return;
		}
		phrases.push({ start: c.start, end: c.end, text: lines.join(' ') });
	});
	return phrases;
}
