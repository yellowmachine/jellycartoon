import { and, asc, desc, eq, gt, lt, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { album, musicPlaylist, musicPlaylistItem, track } from '#lib/server/db/schema.ts';
import type { MusicTrack } from '#lib/music.ts';

/** Playlists of tracks, shared by the whole house: anyone can change any of them. */

/** Tracks that can be played: catalogued and still in the folder. */
const playable = and(eq(track.status, 'ready'), eq(track.missing, false));

/** Newest first, with what each one has. */
export async function listPlaylists() {
	return db
		.select({
			id: musicPlaylist.id,
			name: musicPlaylist.name,
			total: sql<number>`count(${track.id})::int`,
			durationSec: sql<number>`coalesce(sum(${track.durationSec}), 0)::real`
		})
		.from(musicPlaylist)
		.leftJoin(musicPlaylistItem, eq(musicPlaylistItem.playlistId, musicPlaylist.id))
		.leftJoin(track, and(eq(track.id, musicPlaylistItem.trackId), playable))
		.groupBy(musicPlaylist.id)
		.orderBy(desc(musicPlaylist.createdAt), desc(musicPlaylist.id));
}

/** The names, to pick one when adding a track. */
export async function playlistNames() {
	return db
		.select({ id: musicPlaylist.id, name: musicPlaylist.name })
		.from(musicPlaylist)
		.orderBy(desc(musicPlaylist.createdAt), desc(musicPlaylist.id));
}

/** The playlist and its tracks in order, each with its item id (a track can be there twice). */
export async function getPlaylist(id: number) {
	const [playlist] = await db
		.select({ id: musicPlaylist.id, name: musicPlaylist.name })
		.from(musicPlaylist)
		.where(eq(musicPlaylist.id, id));
	if (!playlist) return null;
	const rows = await db
		.select({
			itemId: musicPlaylistItem.id,
			id: track.id,
			title: track.title,
			artist: track.artist,
			number: track.number,
			durationSec: track.durationSec,
			albumId: album.id,
			album: album.title,
			albumArtist: album.artist,
			coverStatus: album.coverStatus
		})
		.from(musicPlaylistItem)
		.innerJoin(track, and(eq(track.id, musicPlaylistItem.trackId), playable))
		.innerJoin(album, eq(album.id, track.albumId))
		.where(eq(musicPlaylistItem.playlistId, id))
		.orderBy(asc(musicPlaylistItem.position), asc(musicPlaylistItem.id));
	return {
		...playlist,
		items: rows.map((r) => ({
			itemId: r.itemId,
			track: {
				id: r.id,
				title: r.title,
				artist: r.artist ?? r.albumArtist,
				number: r.number,
				durationSec: r.durationSec,
				albumId: r.albumId,
				album: r.album,
				hasCover: r.coverStatus === 'found'
			} satisfies MusicTrack
		}))
	};
}

export async function createPlaylist(name: string) {
	const [playlist] = await db
		.insert(musicPlaylist)
		.values({ name })
		.returning({ id: musicPlaylist.id });
	return playlist.id;
}

export async function renamePlaylist(id: number, name: string) {
	await db.update(musicPlaylist).set({ name }).where(eq(musicPlaylist.id, id));
}

export async function deletePlaylist(id: number) {
	await db.delete(musicPlaylist).where(eq(musicPlaylist.id, id));
}

/** At the end; if it is already there, once more. */
export async function addToPlaylist(playlistId: number, trackId: number) {
	await db.insert(musicPlaylistItem).values({
		playlistId,
		trackId,
		position: sql`(select coalesce(max(${musicPlaylistItem.position}) + 1, 0) from ${musicPlaylistItem} where ${musicPlaylistItem.playlistId} = ${playlistId})`
	});
}

export async function removeFromPlaylist(playlistId: number, itemId: number) {
	await db
		.delete(musicPlaylistItem)
		.where(and(eq(musicPlaylistItem.id, itemId), eq(musicPlaylistItem.playlistId, playlistId)));
}

/** Swaps the item with the one before (-1) or after (+1) it, among those that are shown. */
export async function moveInPlaylist(playlistId: number, itemId: number, direction: -1 | 1) {
	await db.transaction(async (tx) => {
		const [item] = await tx
			.select({ position: musicPlaylistItem.position })
			.from(musicPlaylistItem)
			.where(and(eq(musicPlaylistItem.id, itemId), eq(musicPlaylistItem.playlistId, playlistId)));
		if (!item) return;
		const [neighbour] = await tx
			.select({ id: musicPlaylistItem.id, position: musicPlaylistItem.position })
			.from(musicPlaylistItem)
			.innerJoin(track, and(eq(track.id, musicPlaylistItem.trackId), playable))
			.where(
				and(
					eq(musicPlaylistItem.playlistId, playlistId),
					direction < 0
						? lt(musicPlaylistItem.position, item.position)
						: gt(musicPlaylistItem.position, item.position)
				)
			)
			.orderBy(direction < 0 ? desc(musicPlaylistItem.position) : asc(musicPlaylistItem.position))
			.limit(1);
		if (!neighbour) return;
		await tx
			.update(musicPlaylistItem)
			.set({ position: neighbour.position })
			.where(eq(musicPlaylistItem.id, itemId));
		await tx
			.update(musicPlaylistItem)
			.set({ position: item.position })
			.where(eq(musicPlaylistItem.id, neighbour.id));
	});
}
