import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, asc, eq, exists, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { album, albumArtistName, albumTitle, track } from '#lib/server/db/schema.ts';
import { coverImage, probe } from '#lib/server/library/ffmpeg.ts';
import { albumCoverFile, musicFile } from '#lib/server/library/paths.ts';
import { log } from '#lib/server/log.ts';
import { musicProgress } from './status.ts';
import { isOpus, searchTitles, titlesMatch, VARIOUS_ARTISTS } from './tags.ts';

/**
 * Album covers: the release in MusicBrainz (https://musicbrainz.org/doc/MusicBrainz_API), by disc
 * id or by title and artist, and its front cover in the Cover Art Archive
 * (https://musicbrainz.org/doc/Cover_Art_Archive/API). Both public, no key needed. Or the picture
 * inside its first track: first for Opus (yt-dlp's `--embed-thumbnail`, a playlist MusicBrainz
 * does not know, and whose name could match another album), last for a CD rip.
 */

/** MusicBrainz asks every client to identify itself, and for one request a second at most. */
const USER_AGENT = 'JellyCartoon/1.0 (https://github.com/yellowmachine/jellycartoon)';
const MB_INTERVAL_MS = 1100;
let lastRequest = 0;

export interface Release {
	id: string;
	title: string;
	score?: number;
	date?: string;
	'artist-credit'?: { name: string; joinphrase?: string }[];
	'release-group'?: { id: string };
}

/**
 * Busy, MusicBrainz answers 503 even to clients within its pace, and asks them to slow down and
 * try again: https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting. This many times more,
 * after its Retry-After or 2, 4 and 8 s.
 */
const MB_RETRIES = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function musicBrainz(pathAndQuery: string) {
	const separator = pathAndQuery.includes('?') ? '&' : '?';
	for (let attempt = 0; ; attempt++) {
		const wait = lastRequest + MB_INTERVAL_MS - Date.now();
		if (wait > 0) await sleep(wait);
		lastRequest = Date.now();
		const res = await fetch(`https://musicbrainz.org/ws/2/${pathAndQuery}${separator}fmt=json`, {
			headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
			signal: AbortSignal.timeout(20_000)
		});
		if (res.status === 503 && attempt < MB_RETRIES) {
			const after = Number(res.headers.get('retry-after'));
			await sleep((after > 0 ? after : 2 ** (attempt + 1)) * 1000);
			continue;
		}
		if (res.status === 404) return null;
		if (!res.ok) throw new Error(`MusicBrainz respondió ${res.status}`);
		return res.json() as Promise<{ releases?: Release[] }>;
	}
}

export const quote = (value: string) => `"${value.replace(/["\\]/g, '\\$&')}"`;
/** Lucene's special characters out: the words alone. */
export const words = (value: string) =>
	`(${value.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, ' ').trim()})`;

/**
 * Best first: the exact disc if its id is known, then a search by title (and artist), first as a
 * phrase and then by words, which finds «Greatest Hits I, II & III» for «Greatest Hits I».
 */
async function candidates(a: { title: string; artist: string; discId: string | null }) {
	if (a.discId) {
		const found = await musicBrainz(`discid/${encodeURIComponent(a.discId)}?inc=release-groups`);
		if (found?.releases?.length) return found.releases;
	}
	const artist = a.artist && a.artist !== VARIOUS_ARTISTS ? ` AND artist:${quote(a.artist)}` : '';
	for (const title of searchTitles(a.title)) {
		for (const release of [quote(title), words(title)]) {
			const query = `release:${release}${artist}`;
			const found = await musicBrainz(`release?limit=10&query=${encodeURIComponent(query)}`);
			const good =
				found?.releases?.filter((r) => (r.score ?? 0) >= 90 && titlesMatch(title, r.title)) ?? [];
			if (good.length) return good;
		}
	}
	return [];
}

/** The 500 px front cover (always a JPEG) of a release or a release group, if there is one. */
export async function downloadFront(kind: 'release' | 'release-group', id: string, file: string) {
	const res = await fetch(`https://coverartarchive.org/${kind}/${id}/front-500`, {
		headers: { 'User-Agent': USER_AGENT },
		signal: AbortSignal.timeout(30_000)
	});
	if (res.status === 404) return false;
	if (!res.ok) throw new Error(`Cover Art Archive respondió ${res.status}`);
	const partial = file.replace(/\.jpg$/, '.part.jpg');
	await mkdir(path.dirname(file), { recursive: true });
	try {
		await writeFile(partial, new Uint8Array(await res.arrayBuffer()));
		await rename(partial, file);
	} finally {
		await rm(partial, { force: true });
	}
	return true;
}

/** The picture inside the album's first track, if it has one. */
async function embeddedCover(albumId: number, file: string) {
	const info = await probe(file, undefined, false);
	const picture = info.streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic);
	if (!picture) return false;
	const cover = albumCoverFile(albumId);
	const partial = cover.replace(/\.jpg$/, '.part.jpg');
	await mkdir(path.dirname(cover), { recursive: true });
	try {
		await coverImage(file, picture.index, partial);
		await rename(partial, cover);
	} finally {
		await rm(partial, { force: true });
	}
	return true;
}

/** Albums with tracks and no cover looked up yet; a network failure leaves them for next time. */
export async function findCovers() {
	const pending = await db
		.select({ id: album.id, title: albumTitle, artist: albumArtistName, discId: album.discId })
		.from(album)
		.where(
			and(
				eq(album.coverStatus, 'pending'),
				exists(
					db
						.select({ id: track.id })
						.from(track)
						.where(
							and(eq(track.albumId, album.id), eq(track.status, 'ready'), eq(track.missing, false))
						)
				)
			)
		);

	Object.assign(musicProgress, { phase: 'covers', coversDone: 0, coversTotal: pending.length });
	for (const a of pending) {
		musicProgress.coversDone++;
		try {
			const [first] = await db
				.select({ path: track.path })
				.from(track)
				.where(and(eq(track.albumId, a.id), eq(track.status, 'ready'), eq(track.missing, false)))
				.orderBy(sql`${track.number} nulls last`, asc(track.id))
				.limit(1);
			const opus = first ? isOpus(first.path) : false;
			let source: string | null =
				first && opus && (await embeddedCover(a.id, musicFile(first.path))) ? 'embedded' : null;
			const groups = new Set<string>();
			for (const release of source ? [] : await candidates(a)) {
				if (await downloadFront('release', release.id, albumCoverFile(a.id))) {
					source = `release/${release.id}`;
					break;
				}
				// Many releases have no art of their own, but another edition of the album does.
				const group = release['release-group']?.id;
				if (group && !groups.has(group)) {
					groups.add(group);
					if (await downloadFront('release-group', group, albumCoverFile(a.id))) {
						source = `release-group/${group}`;
						break;
					}
				}
			}
			if (!source && first && !opus && (await embeddedCover(a.id, musicFile(first.path))))
				source = 'embedded';
			const found = source !== null;
			await db
				.update(album)
				.set({ coverStatus: found ? 'found' : 'not_found', coverSource: source })
				.where(eq(album.id, a.id));
			if (!found)
				log.info('música', `Sin portada para ${a.artist} - ${a.title}`, { albumId: a.id });
		} catch (error) {
			log.warn('música', `No se pudo buscar la portada de ${a.artist} - ${a.title}`, {
				albumId: a.id,
				error
			});
		}
	}
	if (pending.length) log.info('música', `Buscadas las portadas de ${pending.length} álbumes`);
}
