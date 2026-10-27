import { fold, type MusicAlbum, type MusicTrack } from '#lib/music.ts';

/**
 * The voice's `search_music` (command.ts): artists, albums, playlists and songs by their words,
 * whatever the accents and case. What is said comes from Whisper, which writes some names as they
 * sound («Boyman Rhapsody»): if nothing has every word, the ones that sound alike, word by word, so
 * that the AI finds it at once instead of searching again (2026-10-27, four rounds for one song).
 */

/** Said around a name, not part of it. */
const FILLER = new Set(
	'el la los las un una de del y a en the of and cancion canciones disco album grupo pon quiero escuchar'.split(
		' '
	)
);
/** How alike, from 0 to 1, a word must be to another to count; and a whole name. */
const WORD_ALIKE = 0.6;
const NAME_ALIKE = 0.75;

const words = (text: string) =>
	fold(text)
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);

/** Levenshtein's: the fewest letters to add, take or change to go from one to the other. */
function distance(a: string, b: string) {
	let row = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const next = [i];
		for (let j = 1; j <= b.length; j++)
			next[j] = Math.min(
				row[j]! + 1,
				next[j - 1]! + 1,
				row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
			);
		row = next;
	}
	return row[b.length]!;
}

const alike = (a: string, b: string) => 1 - distance(a, b) / Math.max(a.length, b.length);

/**
 * How much `text` sounds like what was asked (its words, without the fillers), from 0 to 1: each
 * word asked, as alike as the most alike of `text`'s, and those under `WORD_ALIKE` as none.
 */
export function likeness(asked: string[], text: string) {
	const theirs = words(text);
	if (!asked.length || !theirs.length) return 0;
	const each = asked.map((w) => Math.max(...theirs.map((t) => alike(w, t))));
	return each.reduce((sum, s) => sum + (s >= WORD_ALIKE ? s : 0), 0) / asked.length;
}

export function searchMusic(
	query: string,
	albums: MusicAlbum[],
	playlists: { id: number; name: string }[]
) {
	const all = fold(query).split(/\s+/).filter(Boolean);
	const tracks = albums.flatMap((a) => a.tracks);
	const artistNames = [...new Set(albums.map((a) => a.artist))];
	const show = {
		album: (a: MusicAlbum) => ({ id: a.id, title: a.title, artist: a.artist }),
		track: (t: MusicTrack) => ({ id: t.id, title: t.title, artist: t.artist, album: t.album })
	};

	// Every word, as it is.
	const hit = (text: string) => {
		const haystack = fold(text);
		return all.every((w) => haystack.includes(w));
	};
	const found = {
		artists: artistNames.filter(hit).slice(0, 10),
		albums: albums
			.filter((a) => hit(`${a.title} ${a.artist}`))
			.slice(0, 10)
			.map(show.album),
		playlists: playlists.filter((p) => hit(p.name)).slice(0, 10),
		tracks: tracks
			.filter((t) => hit(`${t.title} ${t.artist}`))
			.slice(0, 15)
			.map(show.track)
	};
	if (found.artists.length + found.albums.length + found.playlists.length + found.tracks.length)
		return JSON.stringify(found);

	// None: the ones that sound alike, the most alike first.
	const asked = words(query).filter((w) => !FILLER.has(w));
	const best = <T>(items: T[], text: (item: T) => string, max: number) =>
		items
			.map((item) => ({ item, score: likeness(asked, text(item)) }))
			.filter((s) => s.score >= NAME_ALIKE)
			.sort((a, b) => b.score - a.score)
			.slice(0, max)
			.map((s) => s.item);
	const alikeFound = {
		artists: best(artistNames, (a) => a, 5),
		albums: best(albums, (a) => `${a.title} ${a.artist}`, 5).map(show.album),
		playlists: best(playlists, (p) => p.name, 5),
		tracks: best(tracks, (t) => `${t.title} ${t.artist}`, 8).map(show.track)
	};
	const total =
		alikeFound.artists.length +
		alikeFound.albums.length +
		alikeFound.playlists.length +
		alikeFound.tracks.length;
	return total
		? `Nada con «${query}» tal cual; lo que más se le parece, por cómo suena: ${JSON.stringify(alikeFound)}`
		: `Nada con «${query}». Prueba con otras palabras.`;
}
