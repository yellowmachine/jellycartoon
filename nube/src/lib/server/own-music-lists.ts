import { and, asc, count, eq, gt, inArray, lt, desc, sql } from 'drizzle-orm';
import { asFamily } from './family.ts';
import { ownAlbum, ownPlaylist, ownPlaylistItem, ownTrack } from './db/schema.ts';
import type { OwnAlbumRow, OwnTrackRow } from './own-music.ts';
import { moveBefore } from 'comun/reorder.ts';

/**
 * The playlists of «Tu música» (#534, phase 2): the whole family's, kept in Seilide, only with the
 * bucket's songs. As the house's: made, renamed and deleted by anyone, songs added at the end,
 * moved up and down, taken out.
 */

/** At most this many at once: a whole album, the queue. */
export const MAX_TRACKS = 2000;
export const NAME_MAX = 100;

export interface OwnPlaylistSummary {
	id: number;
	name: string;
	total: number;
	durationSec: number;
}

/** A song of a list, with what the player needs of its album (own-music.ts' asTrack). */
export interface OwnPlaylistItem {
	itemId: number;
	track: OwnTrackRow;
	album: Pick<OwnAlbumRow, 'id' | 'title' | 'hasCover' | 'coverVersion'>;
}

export async function ownPlaylists(familyId: string): Promise<OwnPlaylistSummary[]> {
	return asFamily(familyId, async (tx) => {
		const rows = await tx
			.select({
				id: ownPlaylist.id,
				name: ownPlaylist.name,
				total: count(ownPlaylistItem.id),
				durationSec: sql<number>`coalesce(sum(${ownTrack.durationSec}), 0)::int`
			})
			.from(ownPlaylist)
			.leftJoin(ownPlaylistItem, eq(ownPlaylistItem.playlistId, ownPlaylist.id))
			.leftJoin(ownTrack, eq(ownTrack.id, ownPlaylistItem.trackId))
			.groupBy(ownPlaylist.id, ownPlaylist.name)
			.orderBy(asc(ownPlaylist.name));
		return rows.map((r) => ({ ...r, total: Number(r.total) }));
	});
}

/** Only the family's songs: another's id, or one gone, is left out. */
async function theirs(tx: Parameters<Parameters<typeof asFamily>[1]>[0], trackIds: number[]) {
	if (!trackIds.length) return [];
	const found = new Set(
		(await tx.select({ id: ownTrack.id }).from(ownTrack).where(inArray(ownTrack.id, trackIds))).map(
			(r) => r.id
		)
	);
	return trackIds.filter((id) => found.has(id));
}

/** Songs at the end of a list, in that order. False, not the family's list. */
export async function addToOwnPlaylist(familyId: string, playlistId: number, trackIds: number[]) {
	return asFamily(familyId, async (tx) => {
		const [list] = await tx
			.select({ id: ownPlaylist.id })
			.from(ownPlaylist)
			.where(eq(ownPlaylist.id, playlistId));
		if (!list) return false;
		const ids = await theirs(tx, trackIds);
		if (!ids.length) return true;
		const [{ last }] = (await tx
			.select({ last: sql<number>`coalesce(max(${ownPlaylistItem.position}), 0)::int` })
			.from(ownPlaylistItem)
			.where(eq(ownPlaylistItem.playlistId, playlistId))) as [{ last: number }];
		await tx
			.insert(ownPlaylistItem)
			.values(ids.map((trackId, i) => ({ familyId, playlistId, trackId, position: last + i + 1 })));
		return true;
	});
}

/** A new list, with those songs in it if any; its id. */
export async function createOwnPlaylist(familyId: string, name: string, trackIds: number[] = []) {
	const [list] = await asFamily(familyId, (tx) =>
		tx
			.insert(ownPlaylist)
			.values({ familyId, name: name.slice(0, NAME_MAX) })
			.returning({ id: ownPlaylist.id })
	);
	if (trackIds.length) await addToOwnPlaylist(familyId, list!.id, trackIds);
	return list!.id;
}

/** A list with its songs in order; null, not the family's. */
export async function ownPlaylistOf(familyId: string, id: number) {
	return asFamily(familyId, async (tx) => {
		const [list] = await tx
			.select({ id: ownPlaylist.id, name: ownPlaylist.name })
			.from(ownPlaylist)
			.where(eq(ownPlaylist.id, id));
		if (!list) return null;
		const rows = await tx
			.select({
				itemId: ownPlaylistItem.id,
				track: {
					id: ownTrack.id,
					albumId: ownTrack.albumId,
					title: ownTrack.title,
					artist: ownTrack.artist,
					disc: ownTrack.disc,
					number: ownTrack.number,
					durationSec: ownTrack.durationSec,
					mime: ownTrack.mime
				},
				album: {
					id: ownAlbum.id,
					title: sql<string>`coalesce(${ownAlbum.customTitle}, ${ownAlbum.title})`,
					coverKey: ownAlbum.coverKey,
					coverFile: ownAlbum.coverFile
				}
			})
			.from(ownPlaylistItem)
			.innerJoin(ownTrack, eq(ownTrack.id, ownPlaylistItem.trackId))
			.innerJoin(ownAlbum, eq(ownAlbum.id, ownTrack.albumId))
			.where(eq(ownPlaylistItem.playlistId, id))
			.orderBy(asc(ownPlaylistItem.position), asc(ownPlaylistItem.id));
		const items: OwnPlaylistItem[] = rows.map((r) => ({
			itemId: r.itemId,
			track: r.track,
			album: {
				id: r.album.id,
				title: r.album.title,
				hasCover: Boolean(r.album.coverKey || r.album.coverFile),
				coverVersion: r.album.coverKey ?? r.album.coverFile
			}
		}));
		return { ...list, items };
	});
}

export const renameOwnPlaylist = (familyId: string, id: number, name: string) =>
	asFamily(familyId, (tx) =>
		tx
			.update(ownPlaylist)
			.set({ name: name.slice(0, NAME_MAX) })
			.where(eq(ownPlaylist.id, id))
	);

export const deleteOwnPlaylist = (familyId: string, id: number) =>
	asFamily(familyId, (tx) => tx.delete(ownPlaylist).where(eq(ownPlaylist.id, id)));

export const removeFromOwnPlaylist = (familyId: string, id: number, itemId: number) =>
	asFamily(familyId, (tx) =>
		tx
			.delete(ownPlaylistItem)
			.where(and(eq(ownPlaylistItem.playlistId, id), eq(ownPlaylistItem.id, itemId)))
	);

/** One place up or down: swapped with the one before or after it. */
export async function moveInOwnPlaylist(
	familyId: string,
	id: number,
	itemId: number,
	way: 'up' | 'down'
) {
	await asFamily(familyId, async (tx) => {
		const [item] = await tx
			.select({ position: ownPlaylistItem.position })
			.from(ownPlaylistItem)
			.where(and(eq(ownPlaylistItem.playlistId, id), eq(ownPlaylistItem.id, itemId)));
		if (!item) return;
		const [other] = await tx
			.select({ id: ownPlaylistItem.id, position: ownPlaylistItem.position })
			.from(ownPlaylistItem)
			.where(
				and(
					eq(ownPlaylistItem.playlistId, id),
					way === 'up'
						? lt(ownPlaylistItem.position, item.position)
						: gt(ownPlaylistItem.position, item.position)
				)
			)
			.orderBy(way === 'up' ? desc(ownPlaylistItem.position) : asc(ownPlaylistItem.position))
			.limit(1);
		if (!other) return;
		await tx
			.update(ownPlaylistItem)
			.set({ position: other.position })
			.where(eq(ownPlaylistItem.id, itemId));
		await tx
			.update(ownPlaylistItem)
			.set({ position: item.position })
			.where(eq(ownPlaylistItem.id, other.id));
	});
}

/** Dragged into place: just before `beforeId` (null: at the end); positions numbered from 0. */
export async function moveInOwnPlaylistBefore(
	familyId: string,
	id: number,
	itemId: number,
	beforeId: number | null
) {
	await asFamily(familyId, async (tx) => {
		const rows = await tx
			.select({ id: ownPlaylistItem.id, position: ownPlaylistItem.position })
			.from(ownPlaylistItem)
			.where(eq(ownPlaylistItem.playlistId, id))
			.orderBy(asc(ownPlaylistItem.position), asc(ownPlaylistItem.id));
		const order = moveBefore(
			rows.map((r) => r.id),
			itemId,
			beforeId
		);
		for (const [position, rowId] of order.entries())
			if (rows.find((r) => r.id === rowId)?.position !== position)
				await tx.update(ownPlaylistItem).set({ position }).where(eq(ownPlaylistItem.id, rowId));
	});
}
