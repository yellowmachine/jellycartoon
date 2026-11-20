import type { MusicTrack, SnapcastEpisode, SnapcastQueue } from 'comun/music.ts';
import type { RadioStream } from 'comun/radio.ts';

/**
 * Música → Cola on Snapcast: mpv's playlist (its `playlist` property) as the queue view shows it,
 * and where a dragged entry goes. Pure, to be tested without mpv.
 */

/** One of mpv's playlist entries, as its `playlist` property gives them. */
export interface MpvEntry {
	id: number;
	filename: string;
	current?: boolean;
}

/** What the app put in that entry, if it knows. */
export type KnownEntry =
	{ track: MusicTrack } | { radio: RadioStream } | { listening: { episode: SnapcastEpisode } };

const other = (title: string, artist: string, durationSec: number | null = null): MusicTrack => ({
	id: 0,
	title,
	artist,
	number: null,
	durationSec,
	albumId: 0,
	album: '',
	hasCover: false,
	// Not the library's: left out of «Guardar como lista nueva».
	src: 'snapcast'
});

/** A file name with no folder nor extension: for an entry put on before the app started. */
const nameOf = (filename: string) =>
	decodeURIComponent(filename.split(/[/\\]/).pop() ?? filename).replace(/\.[^.]+$/, '');

export function queueOf(
	playlist: readonly MpvEntry[],
	known: (id: number) => KnownEntry | undefined,
	radio: boolean
): SnapcastQueue {
	const items = playlist.map((e) => {
		const entry = known(e.id);
		const track =
			entry && 'track' in entry
				? entry.track
				: entry && 'radio' in entry
					? other(entry.radio.name, 'Radio')
					: entry && 'listening' in entry
						? other(
								entry.listening.episode.title,
								entry.listening.episode.subtitle,
								entry.listening.episode.durationSec
							)
						: other(nameOf(e.filename), '');
		return { itemId: e.id, track };
	});
	return { items, index: playlist.findIndex((e) => e.current), radio };
}

/**
 * mpv's `playlist-move` for an entry dragged just before another (null: to the end): the entry's
 * index and the one it takes the place of (the count, for the end). Null if it does not move.
 */
export function moveIndexes(
	playlist: readonly MpvEntry[],
	entryId: number,
	beforeId: number | null
): [number, number] | null {
	const from = playlist.findIndex((e) => e.id === entryId);
	if (from < 0 || entryId === beforeId) return null;
	const found = beforeId === null ? -1 : playlist.findIndex((e) => e.id === beforeId);
	const to = found < 0 ? playlist.length : found;
	// Already there: just before it, or the last one sent to the end.
	if (to === from + 1 || (to === playlist.length && from === playlist.length - 1)) return null;
	return [from, to];
}
