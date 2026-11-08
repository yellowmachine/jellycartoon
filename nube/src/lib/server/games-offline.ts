import { and, asc, eq, sum } from 'drizzle-orm';
import { mapDevice, offlineGame, offlineList } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { consoleCovers, gameConsoles, gamePlayer, gameSummary } from '#lib/server/games.ts';
import { HouseProblem, passToHouse } from '#lib/server/house.ts';
import { playlists } from '#lib/server/music.ts';
import { MAX_OFFLINE_BYTES, estimatedBytes, noRoomText } from '#lib/offline-music.ts';
import {
	emulatorFiles,
	type OfflineGameOrder,
	type OfflineGameReport,
	type OfflineGamesView
} from '#lib/offline-games.ts';

/**
 * Games without coverage (offline-games.ts): which of the house's games each device carries,
 * ordered from any of the family's, and how it goes as the device says. The files themselves the
 * device takes through Seilide's /api/juegos/…, as when the game is played, when the app opens on
 * it (offline-games.svelte.ts).
 */

interface Who {
	id: string;
	email: string;
}

const where = (system: string, file: string, deviceId: string) =>
	and(
		eq(offlineGame.system, system),
		eq(offlineGame.file, file),
		eq(offlineGame.deviceId, deviceId)
	);

/** The family's devices, and the games each carries. */
export async function offlineGamesOf(k: Kitchen): Promise<OfflineGamesView> {
	const [devices, games] = await Promise.all([
		k.run((tx) =>
			tx
				.select({ id: mapDevice.id, name: mapDevice.name, lastSeenAt: mapDevice.lastSeenAt })
				.from(mapDevice)
				.orderBy(asc(mapDevice.name))
		),
		k.run((tx) =>
			tx
				.select({
					system: offlineGame.system,
					file: offlineGame.file,
					deviceId: offlineGame.deviceId,
					title: offlineGame.title,
					state: offlineGame.state,
					bytes: offlineGame.bytes,
					problem: offlineGame.problem,
					updatedAt: offlineGame.updatedAt
				})
				.from(offlineGame)
				.orderBy(asc(offlineGame.createdAt))
		)
	]);
	return { devices, games };
}

/** What the device's games take, as last said: for the music's 2 GB too. */
export async function gameBytesOn(k: Kitchen, deviceId: string) {
	const [row] = await k.run((tx) =>
		tx
			.select({ bytes: sum(offlineGame.bytes) })
			.from(offlineGame)
			.where(eq(offlineGame.deviceId, deviceId))
	);
	return Number(row?.bytes ?? 0);
}

/** What the device's lists take, told by their length, as when a list is ordered. */
async function musicBytesOn(k: Kitchen, who: Who, deviceId: string) {
	const carried = await k.run((tx) =>
		tx
			.select({ playlistId: offlineList.playlistId })
			.from(offlineList)
			.where(eq(offlineList.deviceId, deviceId))
	);
	if (!carried.length) return 0;
	const ids = new Set(carried.map((c) => c.playlistId));
	const lengths = (await playlists(who)).filter((p) => ids.has(p.id)).map((p) => p.durationSec);
	return estimatedBytes(lengths);
}

/** A file's size at the house (the player's address, `/api/juegos/…`), without taking it. */
async function sizeAtHouse(who: Who, address: string) {
	const answer = await passToHouse(who.id, who.email, address.replace(/^\/api/, ''), {
		method: 'HEAD',
		headers: new Headers({ 'accept-encoding': 'identity' }),
		signal: AbortSignal.timeout(10_000)
	});
	if (answer.status === 404) throw new HouseProblem('Ese juego ya no está', 404);
	if (!answer.ok) throw new HouseProblem(`La casa contestó ${answer.status}`, answer.status);
	return Number(answer.headers.get('content-length') ?? 0);
}

/**
 * To carry on the device; not if, with what it already carries (its music too), it would go over
 * 2 GB, nor a console the player cannot be had for without coverage. Back, why not; null, ordered.
 */
export async function orderOfflineGame(
	k: Kitchen,
	who: Who,
	system: string,
	file: string,
	deviceId: string
) {
	const [device] = await k.run((tx) =>
		tx.select({ id: mapDevice.id }).from(mapDevice).where(eq(mapDevice.id, deviceId))
	);
	if (!device) return 'Ese dispositivo ya no está';
	const [summary, player] = await Promise.all([
		gameSummary(who, system, file),
		gamePlayer(who, system, file)
	]);
	if (!emulatorFiles(player.core)) return 'Los juegos de esta consola no se pueden llevar';
	const sizes = await Promise.all(
		[player.rom, player.bios].filter((f): f is string => Boolean(f)).map((f) => sizeAtHouse(who, f))
	);
	const bytes = sizes.reduce((a, b) => a + b, 0);
	const [games, music] = await Promise.all([
		gameBytesOn(k, deviceId),
		musicBytesOn(k, who, deviceId)
	]);
	if (games + music + bytes > MAX_OFFLINE_BYTES) return noRoomText;
	await k.run((tx) =>
		tx
			.insert(offlineGame)
			.values({ familyId: k.familyId, system, file, deviceId, title: summary.title, bytes })
			.onConflictDoNothing()
	);
	return null;
}

/** Away: the row now; its files, from the device the next time it opens. */
export async function removeOfflineGame(
	k: Kitchen,
	system: string,
	file: string,
	deviceId: string
) {
	await k.run((tx) => tx.delete(offlineGame).where(where(system, file, deviceId)));
}

/**
 * The device, as the app opens on it: the games it carries, each with what its player needs as it
 * is now at the house (the person's buttons, its cartridge), the first ordered first. A game gone
 * from the house goes from here too. Null, the device is not known (forgotten from another
 * device): what it keeps, it removes.
 */
export async function syncOfflineGames(
	k: Kitchen,
	who: Who,
	deviceId: string
): Promise<OfflineGameOrder[] | null> {
	const [device] = await k.run((tx) =>
		tx.select({ id: mapDevice.id }).from(mapDevice).where(eq(mapDevice.id, deviceId))
	);
	if (!device) return null;
	const rows = await k.run((tx) =>
		tx
			.select({ system: offlineGame.system, file: offlineGame.file, title: offlineGame.title })
			.from(offlineGame)
			.where(eq(offlineGame.deviceId, deviceId))
			.orderBy(asc(offlineGame.createdAt))
	);
	if (!rows.length) return [];
	// Once for all: each game asks the house only for its player (the key has a limit).
	const consoles = new Map((await gameConsoles(who)).map((c) => [c.id, c.name]));
	const covers = new Map<string, Promise<Record<string, string>>>();
	const coversOf = (system: string) => {
		if (!covers.has(system))
			covers.set(
				system,
				consoleCovers(who, system).catch((): Record<string, string> => ({}))
			);
		return covers.get(system)!;
	};
	const orders: OfflineGameOrder[] = [];
	for (const { system, file, title } of rows) {
		let player;
		try {
			player = await gamePlayer(who, system, file);
		} catch (problem) {
			// Removed at the house.
			if (problem instanceof HouseProblem && problem.status === 404) {
				await removeOfflineGame(k, system, file, deviceId);
				continue;
			}
			throw problem;
		}
		orders.push({
			system,
			file,
			title: player.title,
			consoleName: consoles.get(system) ?? system,
			cover: (await coversOf(system))[file] ?? null,
			player
		});
		if (player.title !== title)
			await k.run((tx) =>
				tx
					.update(offlineGame)
					.set({ title: player.title })
					.where(where(system, file, deviceId))
			);
	}
	return orders;
}

/** How it is going, as the device says: only for what it was ordered. */
export async function reportOfflineGame(k: Kitchen, deviceId: string, r: OfflineGameReport) {
	await k.run((tx) =>
		tx
			.update(offlineGame)
			.set({
				state: r.state,
				bytes: r.bytes,
				problem: r.state === 'failed' ? (r.problem ?? 'Error') : null,
				updatedAt: new Date()
			})
			.where(where(r.system, r.file, deviceId))
	);
}
