import { and, asc, eq } from 'drizzle-orm';
import { mapDevice, offlineList } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { HouseProblem } from '#lib/server/house.ts';
import { playlistTracks, playlists } from '#lib/server/music.ts';
import {
	MAX_OFFLINE_BYTES,
	estimatedBytes,
	noRoomText,
	type OfflineListOrder,
	type OfflineListReport,
	type OfflineListsView
} from '#lib/offline-music.ts';

/**
 * Music without coverage (#350): which of the house's playlists each device carries, ordered from
 * any of the family's, and how it goes as the device says. The songs themselves the device takes
 * straight from the house, by the music pass, when the app opens on it (offline-music.svelte.ts).
 */

interface Who {
	id: string;
	email: string;
}

const where = (playlistId: number, deviceId: string) =>
	and(eq(offlineList.playlistId, playlistId), eq(offlineList.deviceId, deviceId));

/** The family's devices, and the lists each carries. */
export async function offlineListsOf(k: Kitchen): Promise<OfflineListsView> {
	const [devices, lists] = await Promise.all([
		k.run((tx) =>
			tx
				.select({ id: mapDevice.id, name: mapDevice.name, lastSeenAt: mapDevice.lastSeenAt })
				.from(mapDevice)
				.orderBy(asc(mapDevice.name))
		),
		k.run((tx) =>
			tx
				.select({
					playlistId: offlineList.playlistId,
					deviceId: offlineList.deviceId,
					name: offlineList.name,
					state: offlineList.state,
					held: offlineList.held,
					total: offlineList.total,
					bytes: offlineList.bytes,
					problem: offlineList.problem,
					updatedAt: offlineList.updatedAt
				})
				.from(offlineList)
				.orderBy(asc(offlineList.createdAt))
		)
	]);
	return { devices, lists };
}

/**
 * To carry on the device; not if, with the lists it already carries, it would go over 2 GB (told
 * by their length). Back, why not; null, ordered.
 */
export async function orderOffline(k: Kitchen, who: Who, playlistId: number, deviceId: string) {
	const [device] = await k.run((tx) =>
		tx.select({ id: mapDevice.id }).from(mapDevice).where(eq(mapDevice.id, deviceId))
	);
	if (!device) return 'Ese dispositivo ya no está';
	const summaries = await playlists(who);
	const list = summaries.find((p) => p.id === playlistId);
	if (!list) return 'Esa lista ya no está';
	const carried = await k.run((tx) =>
		tx
			.select({ playlistId: offlineList.playlistId })
			.from(offlineList)
			.where(eq(offlineList.deviceId, deviceId))
	);
	const ids = new Set([...carried.map((c) => c.playlistId), playlistId]);
	const lengths = summaries.filter((p) => ids.has(p.id)).map((p) => p.durationSec);
	if (estimatedBytes(lengths) > MAX_OFFLINE_BYTES) return noRoomText;
	await k.run((tx) =>
		tx
			.insert(offlineList)
			.values({ familyId: k.familyId, playlistId, deviceId, name: list.name, total: list.total })
			.onConflictDoNothing()
	);
	return null;
}

/** Away: the row now; its songs, from the device the next time it opens. */
export async function removeOffline(k: Kitchen, playlistId: number, deviceId: string) {
	await k.run((tx) => tx.delete(offlineList).where(where(playlistId, deviceId)));
}

/**
 * The device, as the app opens on it: the lists it carries, each with its songs as they are now at
 * the house, the first ordered first. A list gone from the house goes from here too. Null, the
 * device is not known (forgotten from another device): what it keeps, it removes.
 */
export async function syncOffline(
	k: Kitchen,
	who: Who,
	deviceId: string
): Promise<OfflineListOrder[] | null> {
	const [device] = await k.run((tx) =>
		tx.select({ id: mapDevice.id }).from(mapDevice).where(eq(mapDevice.id, deviceId))
	);
	if (!device) return null;
	const rows = await k.run((tx) =>
		tx
			.select({ playlistId: offlineList.playlistId, name: offlineList.name })
			.from(offlineList)
			.where(eq(offlineList.deviceId, deviceId))
			.orderBy(asc(offlineList.createdAt))
	);
	if (!rows.length) return [];
	const names = new Map((await playlists(who)).map((p) => [p.id, p.name]));
	const orders: OfflineListOrder[] = [];
	for (const row of rows) {
		const name = names.get(row.playlistId);
		if (name === undefined) {
			// Removed at the house.
			await removeOffline(k, row.playlistId, deviceId);
			continue;
		}
		try {
			orders.push({ id: row.playlistId, name, tracks: await playlistTracks(who, row.playlistId) });
		} catch (problem) {
			if (problem instanceof HouseProblem && problem.status === 404) {
				await removeOffline(k, row.playlistId, deviceId);
				continue;
			}
			throw problem;
		}
		if (name !== row.name)
			await k.run((tx) =>
				tx.update(offlineList).set({ name }).where(where(row.playlistId, deviceId))
			);
	}
	return orders;
}

/** How it is going, as the device says: only for what it was ordered. */
export async function reportOffline(k: Kitchen, deviceId: string, r: OfflineListReport) {
	await k.run((tx) =>
		tx
			.update(offlineList)
			.set({
				state: r.state,
				held: r.held,
				total: r.total,
				bytes: r.bytes,
				problem: r.state === 'failed' ? (r.problem ?? 'Error') : null,
				updatedAt: new Date()
			})
			.where(where(r.playlistId, deviceId))
	);
}
