/** The lines of a subtitles file that could go on the opening title card, as Frasier's. */

import type { Cue } from '#lib/vtt.ts';

/** What the opening title card shows: a line, and where it is from. */
export interface OpeningQuote {
	text: string;
	series: string;
	season: number;
	number: number;
}

const SENTENCE_END = /[.!?…]["”’']?$/;

/**
 * The cues as sentences: one on two lines is joined, and so is one split across cues (the first
 * does not end a sentence). Songs (♪), sounds ([risas], (door closes)) and two speakers in one cue
 * («- Hi. - Hello.») are left out.
 */
export function subtitleLines(cues: Cue[]): string[] {
	const lines: string[] = [];
	let pending = '';
	for (const cue of cues) {
		const text = cue.text.replace(/\s+/g, ' ').trim();
		if (/[♪♫[\]()]/.test(text) || /^-|\s-\s/.test(text)) {
			pending = '';
			continue;
		}
		pending = pending ? `${pending} ${text}` : text;
		if (SENTENCE_END.test(pending)) {
			lines.push(pending);
			pending = '';
		}
	}
	return lines;
}

export const wordCount = (line: string) => line.split(' ').filter(Boolean).length;

/**
 * Good enough without the AI: a whole sentence (a capital at the start, its end at the end), long
 * enough to say something and short enough to read in a few seconds.
 */
export function goodLine(line: string) {
	const words = wordCount(line);
	return words >= 6 && words <= 20 && /^["“¿¡]?\p{Lu}/u.test(line) && SENTENCE_END.test(line);
}
