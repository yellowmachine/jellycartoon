/** WebVTT subtitles as text: what is said in a stretch of a video, for the clips sent to Langua. */

export interface Cue {
	/** Seconds. */
	start: number;
	end: number;
	text: string;
	/** Rolled-up subtitles (#86): the phrase before, shown above `text`. */
	previous?: string;
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

/** `3725.5` as `01:02:05.500`. */
function timestamp(sec: number) {
	const ms = Math.round(sec * 1000);
	const pad = (n: number, width = 2) => String(n).padStart(width, '0');
	return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
}

/**
 * Cues as a WebVTT file, for the players; `<`, `>` and `&` in their text, escaped. A rolled-up
 * cue's phrase before goes above it, with `dim` in a `prev` class, for the page to dim it
 * (`::cue(.prev)`).
 */
export function serializeVtt(cues: Cue[], { dim = false } = {}) {
	const escape = (text: string) =>
		text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	const text = (c: Cue) =>
		c.previous === undefined
			? escape(c.text)
			: `${dim ? `<c.prev>${escape(c.previous)}</c>` : escape(c.previous)}\n${escape(c.text)}`;
	return (
		[
			'WEBVTT',
			...cues.map((c) => `${timestamp(c.start)} --> ${timestamp(c.end)}\n${text(c)}`)
		].join('\n\n') + '\n'
	);
}

/**
 * Cues as SubRip (.srt), for mpv: its subtitles keep `<font color>` (a .vtt's classes are lost on
 * the way to libass), so a rolled-up cue's phrase before can go grey there too, under the rest of
 * the chosen style. Its own `<` and `>`, as look-alikes: SubRip has no escaping.
 */
export function serializeSrt(cues: Cue[], { dim = false } = {}) {
	const srtTime = (sec: number) => timestamp(sec).replace('.', ',');
	const plainText = (text: string) => text.replace(/</g, '‹').replace(/>/g, '›');
	const text = (c: Cue) =>
		c.previous === undefined
			? plainText(c.text)
			: `${dim ? `<font color="#9a9a9a">${plainText(c.previous)}</font>` : plainText(c.previous)}\n${plainText(c.text)}`;
	return (
		cues
			.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${text(c)}`)
			.join('\n\n') + '\n'
	);
}

/** The cues as running text: one line each, repeated ones (karaoke-style updates) once. */
export const cuesText = (cues: Cue[]) =>
	cues
		.map((c) => c.text.replace(/\s*\n\s*/g, ' '))
		.filter((text, i, all) => text !== all[i - 1])
		.join('\n');
