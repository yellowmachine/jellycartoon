import path from 'node:path';

/**
 * The audio track as one file for mpv: its init and segments joined by ffmpeg's `concat` protocol.
 * mpv cannot seek in these fMP4 HLS playlists (0.40 with ffmpeg 7.1: after a seek, no audio
 * comes), and joined they are one fragmented MP4, where it can.
 */
export function concatInput(dir: string, playlist: string) {
	const init = /#EXT-X-MAP:URI="([^"]+)"/.exec(playlist)?.[1];
	const segments = playlist
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith('#'));
	const files = [...(init ? [init] : []), ...segments];
	return `lavf://concat:${files.map((f) => path.join(dir, f)).join('|')}`;
}
