import { and, asc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { album, track } from '#lib/server/db/schema.ts';
import type { MusicAlbum } from '#lib/music.ts';

/** Albums with their tracks in order, by artist and title; one, or all of them. */
export async function getAlbums(albumId?: number): Promise<MusicAlbum[]> {
	const rows = await db
		.select({
			albumId: album.id,
			album: album.title,
			albumArtist: album.artist,
			coverStatus: album.coverStatus,
			id: track.id,
			title: track.title,
			artist: track.artist,
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
			artist: r.artist ?? r.albumArtist,
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

/** Tracks whose tags are still being read, to show the scan's progress. */
export async function pendingTracks() {
	return db.$count(track, and(eq(track.status, 'pending'), eq(track.missing, false)));
}
