import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	album,
	albumArtistName,
	albumTitle,
	track,
	trackArtist,
	trackTitle
} from '#lib/server/db/schema.ts';
import { musicFile } from '#lib/server/library/paths.ts';
import type { MusicAlbum, MusicTrack } from '#lib/music.ts';
import { wakeMusicCatalog } from './catalog.ts';

/** Albums with their tracks in order, by artist and title; one, or all of them. */
export async function getAlbums(albumId?: number): Promise<MusicAlbum[]> {
	const rows = await db
		.select({
			albumId: album.id,
			album: albumTitle,
			albumArtist: albumArtistName,
			coverStatus: album.coverStatus,
			id: track.id,
			title: trackTitle,
			artist: trackArtist,
			number: track.number,
			durationSec: track.durationSec
		})
		.from(track)
		.innerJoin(album, eq(album.id, track.albumId))
		.where(
			and(
				eq(track.status, 'ready'),
				eq(track.missing, false),
				albumId === undefined ? undefined : eq(album.id, albumId)
			)
		)
		.orderBy(asc(track.number), asc(track.path));

	const albums = new Map<number, MusicAlbum>();
	for (const r of rows) {
		const hasCover = r.coverStatus === 'found';
		let a = albums.get(r.albumId);
		if (!a) {
			a = { id: r.albumId, title: r.album, artist: r.albumArtist, hasCover, tracks: [] };
			albums.set(r.albumId, a);
		}
		a.tracks.push({
			id: r.id,
			title: r.title,
			artist: r.artist,
			number: r.number,
			durationSec: r.durationSec,
			albumId: r.albumId,
			album: r.album,
			hasCover
		});
	}
	const by = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' });
	return [...albums.values()].sort((a, b) => by(a.artist, b.artist) || by(a.title, b.title));
}

/**
 * The tracks, in the order asked, with their files; the ones no longer there are left out. Paths
 * come from the catalogue, never the page.
 */
export async function tracksById(ids: number[]) {
	if (!ids.length) return [];
	const rows = await db
		.select({ id: track.id, path: track.path, albumId: track.albumId })
		.from(track)
		.where(and(inArray(track.id, ids), eq(track.status, 'ready'), eq(track.missing, false)));
	const albumIds = [...new Set(rows.map((r) => r.albumId!))];
	const tracks = new Map<number, MusicTrack>();
	for (const id of albumIds)
		for (const a of await getAlbums(id)) for (const t of a.tracks) tracks.set(t.id, t);
	const paths = new Map(rows.map((r) => [r.id, musicFile(r.path)]));
	return ids.flatMap((id) => {
		const t = tracks.get(id);
		const path = paths.get(id);
		return t && path ? [{ track: t, path }] : [];
	});
}

/** For the TV view's Música card: how many albums can be played, and the newest covers. */
export async function albumCovers(limit: number) {
	const rows = await db
		.select({ id: album.id, coverStatus: album.coverStatus })
		.from(album)
		.innerJoin(
			track,
			and(eq(track.albumId, album.id), eq(track.status, 'ready'), eq(track.missing, false))
		)
		.groupBy(album.id)
		.orderBy(desc(album.id));
	return {
		count: rows.length,
		covers: rows.flatMap((r) => (r.coverStatus === 'found' ? r.id : [])).slice(0, limit)
	};
}

/** Counts for the Música page, like Gestión's for the episodes. */
export async function musicTotals() {
	const [tracks] = await db
		.select({
			ready: sql<number>`count(*) filter (where ${track.status} = 'ready')::int`,
			pending: sql<number>`count(*) filter (where ${track.status} = 'pending')::int`,
			ignored: sql<number>`count(*) filter (where ${track.status} = 'ignored')::int`,
			errors: sql<number>`count(*) filter (where ${track.status} = 'error')::int`
		})
		.from(track)
		.where(eq(track.missing, false));
	// Albums with something to play, and how their cover search went.
	const [covers] = await db
		.select({
			albums: sql<number>`count(distinct ${album.id})::int`,
			found: sql<number>`count(distinct ${album.id}) filter (where ${album.coverStatus} = 'found')::int`,
			notFound: sql<number>`count(distinct ${album.id}) filter (where ${album.coverStatus} = 'not_found')::int`
		})
		.from(album)
		.innerJoin(
			track,
			and(eq(track.albumId, album.id), eq(track.status, 'ready'), eq(track.missing, false))
		);
	const errorsList = await db
		.select({ id: track.id, path: track.path, error: track.error })
		.from(track)
		.where(and(eq(track.status, 'error'), eq(track.missing, false)))
		.orderBy(desc(track.id))
		.limit(50);
	return { ...tracks, ...covers, errorsList };
}

/** The titles from the tags, which an empty title goes back to. */
export async function tagTitles(albumId: number) {
	const [a] = await db
		.select({ title: album.title, artist: album.artist })
		.from(album)
		.where(eq(album.id, albumId));
	const tracks = await db
		.select({ id: track.id, title: track.title })
		.from(track)
		.where(eq(track.albumId, albumId));
	return {
		album: a?.title ?? '',
		artist: a?.artist ?? '',
		tracks: Object.fromEntries(tracks.map((t) => [t.id, t.title]))
	};
}

/**
 * Its title or its artist; empty goes back to the one from the tags. An album left without a cover
 * is looked up again: a corrected title or artist may find it.
 */
export async function renameAlbum(albumId: number, field: 'title' | 'artist', value: string) {
	const [renamed] = await db
		.update(album)
		.set({
			[field === 'title' ? 'customTitle' : 'customArtist']: value || null,
			coverStatus: sql`case when ${album.coverStatus} = 'not_found' then 'pending' else ${album.coverStatus} end`
		})
		.where(eq(album.id, albumId))
		.returning({ coverStatus: album.coverStatus });
	if (renamed?.coverStatus === 'pending') void wakeMusicCatalog();
}

export async function renameTrack(albumId: number, trackId: number, title: string) {
	await db
		.update(track)
		.set({ customTitle: title || null })
		.where(and(eq(track.id, trackId), eq(track.albumId, albumId)));
}
