/** WebVTT subtitles as text: what is said in a stretch of a video, for the clips sent to Langua. */

export interface Cue {
	/** Seconds. */
	start: number;
	end: number;
	text: string;
}

/** `01:02:03.456` or `02:03.456` as seconds; null if it is not a time. */
function seconds(time: string) {
	const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(time.trim());
	if (!match) return null;
	const [, h, m, s, ms] = match;
	return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms!.padEnd(3, '0')) / 1000;
}

/** Tags (`<i>`, `<c.yellow>`, `<00:01.000>`) out, and the few entities WebVTT has, decoded. */
function plain(text: string) {
	return text
		.replace(/<[^>]*>/g, '')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.trim();
}

/** Every cue with text, in the order of the file; notes, styles and regions left out. */
export function parseVtt(vtt: string): Cue[] {
	const cues: Cue[] = [];
	for (const block of vtt.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
		const lines = block.split('\n');
		const at = lines.findIndex((l) => l.includes('-->'));
		if (at < 0) continue;
		const [from, rest] = lines[at]!.split('-->');
		const start = seconds(from ?? '');
		// Cue settings («align:start») follow the end time.
		const end = seconds((rest ?? '').trim().split(/\s+/)[0] ?? '');
		const text = plain(lines.slice(at + 1).join('\n'));
		if (start !== null && end !== null && text) cues.push({ start, end, text });
	}
	return cues;
}

/**
 * The cues said between `from` and `to` (seconds), with their times from `from`; one that is half
 * in counts, so no sentence is cut.
 */
export function cuesBetween(cues: Cue[], from: number, to: number): Cue[] {
	return cues
		.filter((c) => c.end > from && c.start < to)
		.map((c) => ({
			start: Math.max(0, +(c.start - from).toFixed(3)),
			end: +(c.end - from).toFixed(3),
			text: c.text
		}));
}

/** The cues as running text: one line each, repeated ones (karaoke-style updates) once. */
export const cuesText = (cues: Cue[]) =>
	cues
		.map((c) => c.text.replace(/\s*\n\s*/g, ' '))
		.filter((text, i, all) => text !== all[i - 1])
		.join('\n');
