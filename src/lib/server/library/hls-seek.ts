/**
 * Where a second is in one of our HLS playlists (fMP4): ffmpeg 7.1's HLS reader breaks seeking
 * into them («Invalid NAL unit size»), but the init segment followed by the media segments is a
 * plain fragmented MP4 it reads well. So, the segment that has `atSec`, the ones after it, and how
 * far into it that second is.
 */
export function segmentsFrom(playlist: string, atSec: number) {
	const map = playlist.match(/#EXT-X-MAP:URI="([^"]+)"/)?.[1] ?? null;
	const segments: { uri: string; startSec: number }[] = [];
	let startSec = 0;
	let duration: number | null = null;
	for (const line of playlist.split('\n').map((l) => l.trim())) {
		if (line.startsWith('#EXTINF:')) duration = parseFloat(line.slice('#EXTINF:'.length));
		else if (line && !line.startsWith('#') && duration !== null) {
			segments.push({ uri: line, startSec });
			startSec += duration;
			duration = null;
		}
	}
	if (!map || !segments.length) return null;
	// The last one that starts at or before it; past the end, the last.
	let first = 0;
	while (first + 1 < segments.length && segments[first + 1]!.startSec <= atSec) first++;
	return {
		map,
		segments: segments.slice(first).map((s) => s.uri),
		offsetSec: Math.max(0, atSec - segments[first]!.startSec)
	};
}
