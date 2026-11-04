/**
 * A song's lyrics (house's music, lyrics.ts): with the time of each line (LRC), without, or none
 * since it has no voice. Read from the file's own tags, a `.lrc` beside it, or LRCLIB.
 */
export interface Lyrics {
	kind: 'synced' | 'plain' | 'instrumental';
	/** Each line, with when it is sung (seconds) if `synced`; empty lines kept, as verses. */
	lines: { at: number | null; text: string }[];
}

/** `[mm:ss.xx]` (or `[mm:ss]`, `[mm:ss:xx]`): a line may have several, sung more than once. */
const STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
/** `[ar:…]`, `[ti:…]`, `[offset:…]`: about the file, not the song. */
const TAG = /^\[[a-z]+:.*\]$/i;

/** Whether `text` is LRC: some line starting with a time. */
export const isLrc = (text: string) => /^\s*\[\d{1,3}:\d{1,2}/m.test(text);

/**
 * LRC as lines in the order they are sung; `[offset:+n]` (ms, sooner) applied. Plain text, its
 * lines as they are, without times.
 */
export function parseLyrics(text: string): Lyrics['lines'] {
	const rows = text.replace(/\r/g, '').split('\n');
	if (!isLrc(text)) {
		const lines = rows.map((l) => ({ at: null, text: l.trim() }));
		while (lines.length && !lines.at(-1)!.text) lines.pop();
		while (lines.length && !lines[0]!.text) lines.shift();
		return lines;
	}
	const offset = Number(/^\[offset:\s*([+-]?\d+)\]/im.exec(text)?.[1] ?? 0) / 1000;
	const lines: Lyrics['lines'] = [];
	for (const row of rows) {
		const line = row.trim();
		if (!line || TAG.test(line)) continue;
		const stamps = [...line.matchAll(STAMP)];
		if (!stamps.length) continue;
		const words = line.replace(STAMP, '').trim();
		for (const [, m, s, f] of stamps) {
			const fraction = f ? Number(f) / 10 ** f.length : 0;
			lines.push({
				at: Math.max(0, Number(m) * 60 + Number(s) + fraction - offset),
				text: words
			});
		}
	}
	return lines.sort((a, b) => a.at! - b.at!);
}

/** The line being sung at `sec` (its index): the last that has started; -1 before the first. */
export function lineAt(lines: Lyrics['lines'], sec: number) {
	let found = -1;
	for (let i = 0; i < lines.length; i++) {
		const at = lines[i]!.at;
		if (at === null || at > sec) break;
		found = i;
	}
	return found;
}
