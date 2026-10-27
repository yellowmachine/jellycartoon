/**
 * The light version (light.ts) in an episode's HLS master playlist: one more video variant beside
 * the original, with the same audio group, so the players choose between them. Apart, without
 * the server's modules, to be tested.
 */

/** Its folder, beside `video` in the episode's HLS. */
export const LIGHT_DIR = 'video-720';

const LIGHT_URI = `${LIGHT_DIR}/index.m3u8`;

/** The master playlist without the light variant, as converted. */
export function withoutLight(master: string) {
	const lines = master.split('\n');
	const out: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].startsWith('#EXT-X-STREAM-INF:') && lines[i + 1]?.trim() === LIGHT_URI) {
			i++;
			continue;
		}
		out.push(lines[i]);
	}
	return out.join('\n');
}

/**
 * With the light variant after the original: its bandwidths (bits/s, video and audio), its size,
 * and the original's audio group and audio codec, so it plays with the same tracks.
 */
export function withLight(
	master: string,
	light: { bandwidth: number; averageBandwidth: number; width: number; height: number }
) {
	const base = withoutLight(master).trimEnd();
	const original = base.split('\n').find((l) => l.startsWith('#EXT-X-STREAM-INF:')) ?? '';
	const audio = /AUDIO="([^"]+)"/.exec(original)?.[1];
	const audioCodec = /CODECS="[^"]*?(mp4a[^",]*)/.exec(original)?.[1];
	const attributes = [
		`BANDWIDTH=${Math.round(light.bandwidth)}`,
		`AVERAGE-BANDWIDTH=${Math.round(light.averageBandwidth)}`,
		`RESOLUTION=${light.width}x${light.height}`,
		// High profile, level 4.0 (light.ts).
		`CODECS="avc1.640028${audioCodec ? `,${audioCodec}` : ''}"`,
		...(audio ? [`AUDIO="${audio}"`] : [])
	];
	return `${base}\n#EXT-X-STREAM-INF:${attributes.join(',')}\n${LIGHT_URI}\n`;
}

/** Each segment's seconds and file, from a media playlist. */
export function segmentsOf(playlist: string) {
	const lines = playlist.split('\n').map((l) => l.trim());
	const segments: { seconds: number; file: string }[] = [];
	for (let i = 0; i < lines.length; i++) {
		const match = /^#EXTINF:([\d.]+)/.exec(lines[i]);
		const file = lines[i + 1];
		if (match && file && !file.startsWith('#')) segments.push({ seconds: Number(match[1]), file });
	}
	return segments;
}
