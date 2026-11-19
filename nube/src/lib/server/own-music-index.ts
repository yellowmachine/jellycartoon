/**
 * «Tu música» (#534), what is pure of its index: which files are audios and what the browser is
 * asked about each, which picture is a folder's cover, what an untagged file is called, and what
 * changed in the bucket since the last time. own-music.ts does the rest.
 */

/** Audio files by their extension, and the type the browser is asked about (`canPlayType`). */
export const AUDIO_TYPES: Record<string, string> = {
	mp3: 'audio/mpeg',
	m4a: 'audio/mp4',
	aac: 'audio/aac',
	flac: 'audio/flac',
	ogg: 'audio/ogg',
	oga: 'audio/ogg',
	opus: 'audio/ogg; codecs="opus"',
	wav: 'audio/wav',
	wma: 'audio/x-ms-wma'
};

const extOf = (key: string) => key.slice(key.lastIndexOf('.') + 1).toLowerCase();

/** The type of an audio file, by its extension; null, not one. */
export function audioType(key: string) {
	const name = key.slice(key.lastIndexOf('/') + 1);
	if (name.startsWith('.') || !name.includes('.')) return null;
	return AUDIO_TYPES[extOf(key)] ?? null;
}

/** As read: an `.m4a` with Apple Lossless inside is not what an `.m4a` usually is. */
export function mimeOf(key: string, codec: string | undefined) {
	const type = audioType(key) ?? 'application/octet-stream';
	if (type === 'audio/mp4' && codec?.toUpperCase().includes('ALAC'))
		return 'audio/mp4; codecs="alac"';
	return type;
}

const COVER_NAMES = ['cover', 'folder', 'front', 'album', 'albumart', 'portada'];
const PICTURE_TYPES: Record<string, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp'
};

export const pictureType = (key: string) => PICTURE_TYPES[extOf(key)] ?? null;

/** A folder's key, with its `/`: `Música/Queen/A Night/`. */
export const folderOf = (key: string) => key.slice(0, key.lastIndexOf('/') + 1);

/**
 * Each folder's cover, of the pictures listed: `cover.jpg`, `folder.jpg`… in that order of names;
 * none of those, the only picture in it if there is just one.
 */
export function folderCovers(keys: string[]) {
	const pictures = new Map<string, string[]>();
	for (const key of keys) {
		if (!pictureType(key)) continue;
		const folder = folderOf(key);
		pictures.set(folder, [...(pictures.get(folder) ?? []), key]);
	}
	const covers = new Map<string, string>();
	for (const [folder, list] of pictures) {
		const named = (key: string) => {
			const name = key.slice(folder.length, key.lastIndexOf('.')).toLowerCase();
			const at = COVER_NAMES.indexOf(name);
			return at === -1 ? Infinity : at;
		};
		const best = [...list].sort((a, b) => named(a) - named(b))[0]!;
		if (named(best) !== Infinity || list.length === 1) covers.set(folder, best);
	}
	return covers;
}

export interface Tags {
	title?: string;
	artist?: string;
	albumartist?: string;
	album?: string;
	year?: number;
	track?: { no: number | null };
	disk?: { no: number | null };
}

/** The name of the folder a file is in, last part only; '' at the bucket's folder itself. */
const folderName = (key: string, root: string) => {
	const parts = folderOf(key).slice(root.length).split('/').filter(Boolean);
	return parts.at(-1) ?? '';
};

const clean = (text: string | undefined) => text?.replace(/\s+/g, ' ').trim() || undefined;

/**
 * What a file is, by its tags; without them, by its name and its folder («01 - Bohemian
 * Rhapsody.mp3» in «Queen/A Night at the Opera»: the track 1 of that album).
 */
export function trackInfo(key: string, root: string, tags: Tags) {
	const file = key.slice(key.lastIndexOf('/') + 1, key.lastIndexOf('.'));
	const numbered = /^(\d{1,3})[\s.\-_]+(.+)$/.exec(file);
	const folders = folderOf(key).slice(root.length).split('/').filter(Boolean);
	const artist =
		clean(tags.artist) ??
		clean(tags.albumartist) ??
		(folders.length >= 2 ? folders.at(-2)! : 'Desconocido');
	return {
		title: clean(tags.title) ?? (numbered ? numbered[2]!.trim() : file),
		artist,
		album: clean(tags.album) ?? (folderName(key, root) || 'Sin álbum'),
		albumArtist: clean(tags.albumartist) ?? artist,
		year: tags.year && tags.year > 0 && tags.year < 10_000 ? tags.year : null,
		number: tags.track?.no ?? (numbered ? Number(numbered[1]) : null),
		disc: tags.disk?.no ?? null
	};
}

export interface Listed {
	key: string;
	etag: string;
	size: number;
}

/** What to read again (new or changed: another ETag or size) and which tracks are gone. */
export function changes<T extends Listed & { id: number }>(listed: Listed[], indexed: T[]) {
	const known = new Map(indexed.map((t) => [t.key, t]));
	const there = new Set(listed.map((l) => l.key));
	return {
		read: listed.filter((l) => {
			const t = known.get(l.key);
			return !t || t.etag !== l.etag || t.size !== l.size;
		}),
		gone: indexed.filter((t) => !there.has(t.key)).map((t) => t.id)
	};
}

/**
 * Música → Carpetas from the bucket (#534, phase 3): a folder of it as it is, relative to the
 * music's folder (`root`), with the folders inside (how many tracks, how long) and its own tracks
 * in the order of their names. `path` without slashes at the ends; '' the music's folder. Null, a
 * folder with nothing in it (or none such).
 */
export function folderView<T extends { key: string; durationSec: number | null }>(
	tracks: T[],
	root: string,
	path: string
) {
	const here = path ? `${root}${path}/` : root;
	const inside = new Map<string, { tracks: number; durationSec: number }>();
	const files: T[] = [];
	for (const t of tracks) {
		if (!t.key.startsWith(here)) continue;
		const rest = t.key.slice(here.length);
		const slash = rest.indexOf('/');
		if (slash === -1) {
			files.push(t);
			continue;
		}
		const name = rest.slice(0, slash);
		const f = inside.get(name) ?? { tracks: 0, durationSec: 0 };
		f.tracks++;
		f.durationSec += t.durationSec ?? 0;
		inside.set(name, f);
	}
	if (path && !files.length && !inside.size) return null;
	const byName = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true });
	return {
		path,
		name: path.slice(path.lastIndexOf('/') + 1),
		folders: [...inside]
			.sort(([a], [b]) => byName(a, b))
			.map(([name, f]) => ({ path: path ? `${path}/${name}` : name, name, ...f })),
		tracks: files.sort((a, b) => byName(a.key, b.key))
	};
}
