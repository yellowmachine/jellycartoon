import { createHash } from 'node:crypto';
import path from 'node:path';

/** Pure helpers for the tags of ripped CDs, and for telling them apart from downloads. */

/**
 * The music files catalogued, and their type: CD rips in FLAC, and Opus, like what yt-dlp gets
 * from YouTube with `-x --audio-format opus` (Ogg).
 */
const AUDIO_TYPES: Record<string, string> = { '.flac': 'audio/flac', '.opus': 'audio/ogg' };

export const isMusicFile = (file: string) => path.extname(file).toLowerCase() in AUDIO_TYPES;
export const audioType = (file: string) => AUDIO_TYPES[path.extname(file).toLowerCase()]!;
/** Already Opus: it needs no copy for mobile data (#64), and recompressing it only loses. */
export const isOpus = (file: string) => path.extname(file).toLowerCase() === '.opus';

/** yt-dlp names files after the video, with its 11-character id: `Song [ix5Ntnavdgg].flac`. */
export const isDownload = (file: string) => /\[[\w-]{11}\]\.\w+$/.test(file);

/** Vorbis comments are case-insensitive: Asunder writes `ARTIST` and `track`, fre:ac `album_artist`. */
export function normalizeTags(tags: Record<string, string> | undefined) {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(tags ?? {})) {
		const v = value.trim();
		if (v) out[key.toLowerCase().replace(/_/g, '')] = v;
	}
	return out;
}

/** `01`, `1` or `1/12`. */
export function trackNumber(value: string | undefined) {
	const n = Number.parseInt(value ?? '', 10);
	return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The MusicBrainz disc id from a CDTOC tag (`count+offset…+leadout`, in hex frames, the 150-frame
 * pregap included): https://musicbrainz.org/doc/Disc_ID_Calculation
 */
export function discIdFromToc(cdtoc: string | undefined) {
	const parts = cdtoc?.split('+').map((p) => Number.parseInt(p, 16));
	if (!parts || parts.some((p) => !Number.isFinite(p))) return null;
	const [count, ...rest] = parts;
	if (count < 1 || count > 99 || rest.length !== count + 1) return null;
	const offsets = rest.slice(0, count);
	const leadout = rest[count];
	const hex = (n: number, width: number) => n.toString(16).toUpperCase().padStart(width, '0');
	let toc = hex(1, 2) + hex(count, 2) + hex(leadout, 8);
	for (let i = 0; i < 99; i++) toc += hex(offsets[i] ?? 0, 8);
	return createHash('sha1')
		.update(toc, 'ascii')
		.digest('base64')
		.replace(/\+/g, '.')
		.replace(/\//g, '_')
		.replace(/=/g, '-');
}

/**
 * Titles to look an album up by, best first: without the year some rippers put in front, the disc
 * number or catalogue numbers, and then also without anything in brackets.
 */
export function searchTitles(title: string) {
	const clean = title
		.replace(/^\d{4}\s*-\s*/, '')
		.replace(/\s*\[[^\]]*\]/g, '')
		.replace(/\s*\((?:CD|Dis[ck])\s*[\w]+\)/gi, '')
		.replace(/\s*-\s*(?:CD|Dis[ck])\s*\d+\s*$/i, '')
		.trim();
	const bare = clean.replace(/\s*\([^)]*\)/g, '').trim();
	return [...new Set([clean, bare])].filter(Boolean);
}

const words = (title: string) =>
	title
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);

/**
 * Whether a title found in MusicBrainz is ours: it has (almost) every word of it. A search by words
 * scores unrelated albums of the same artist as high as the right one.
 */
export function titlesMatch(ours: string, found: string) {
	const theirs = new Set(words(found));
	const mine = words(ours);
	if (!mine.length) return false;
	return mine.filter((w) => theirs.has(w)).length / mine.length >= 0.8;
}

export const VARIOUS_ARTISTS = 'Varios artistas';

/** ALBUMARTIST if any track has it, else the artist they share, else several. */
export function albumArtist(tracks: { artist: string | null; albumArtist: string | null }[]) {
	const tagged = tracks.find((t) => t.albumArtist)?.albumArtist;
	if (tagged) return tagged;
	const artists = new Set(tracks.map((t) => t.artist).filter(Boolean));
	return artists.size === 1 ? [...artists][0]! : VARIOUS_ARTISTS;
}
