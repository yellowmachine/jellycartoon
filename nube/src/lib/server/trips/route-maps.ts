import { createHash } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import buffer from '@turf/buffer';
import { lineString } from '@turf/helpers';
import simplify from '@turf/simplify';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { mapDevice, routeMap, savedRoute } from '#lib/server/db/schema.ts';
import { run } from '#lib/server/library/ffmpeg.ts';
import { mapDir, mapFile } from '#lib/server/library/paths.ts';
import { log } from '#lib/server/log.ts';
import type { LngLat } from 'comun/road.ts';
import type { DeviceOrder, HeldMap, RouteMapsView, RouteMapReport } from 'comun/route-maps.ts';

/**
 * Routes' maps for a device without coverage (#164): the strip of Spain's map around a route, cut
 * with go-pmtiles (`pmtiles extract --region`, https://docs.protomaps.com/pmtiles/cli), kept in
 * DATA_DIR/mapa/recorridos while it is current and served by /mapa as the whole map is. Ordered
 * from any device; the device that keeps it downloads and removes it when the app opens on it.
 */

/** Kilometres each side of the way. */
const STRIP_KM = 5;
/** The way, simplified first: some 100 m off is nothing next to the strip. */
const SIMPLIFY_DEGREES = 0.001;
/** `pmtiles` in the image (Dockerfile); elsewhere, where PMTILES says. */
const PMTILES = process.env.PMTILES ?? 'pmtiles';

const dir = path.join(mapDir, 'recorridos');

/** The map and the way it is cut from, and how: a different one, the copy kept is old. */
async function versionOf(line: LngLat[]) {
	const map = await stat(mapFile);
	return createHash('sha256')
		.update(JSON.stringify([map.size, map.mtimeMs, STRIP_KM, line]))
		.digest('hex')
		.slice(0, 12);
}

/** The strip around the way, as GeoJSON for `--region`. */
export function strip(line: LngLat[]) {
	const way = simplify(lineString(line), { tolerance: SIMPLIFY_DEGREES, highQuality: true });
	return buffer(way, STRIP_KM, { units: 'kilometers' });
}

const fileOf = (routeId: number, version: string) =>
	path.join(dir, `${routeId}-${version}.pmtiles`);

/** Cutting now, by file: asked twice, cut once. */
const cutting = new Map<string, Promise<void>>();

async function cut(line: LngLat[], file: string) {
	await mkdir(dir, { recursive: true });
	const region = `${file}.geojson`;
	const part = `${file}.part`;
	await writeFile(region, JSON.stringify(strip(line)));
	const started = Date.now();
	try {
		await run(PMTILES, ['extract', mapFile, part, `--region=${region}`, '--quiet'], {
			pausable: false
		});
		await rename(part, file);
		log.info('mapas', `Mapa de un recorrido recortado: ${path.basename(file)}`, {
			bytes: (await stat(file)).size,
			ms: Date.now() - started
		});
	} finally {
		await rm(region, { force: true });
		await rm(part, { force: true });
	}
}

/** The route's maps other than this version (or all of them): no longer of use. */
export async function forgetRouteMaps(routeId: number, keep?: string) {
	const names = await readdir(dir).catch(() => []);
	for (const name of names)
		if (name.startsWith(`${routeId}-`) && name !== (keep && path.basename(keep)))
			await rm(path.join(dir, name), { force: true });
}

/**
 * The route's map, cut if it is not yet: its address under /mapa, size and version. Its owner may
 * ask, or the device it was ordered for.
 */
export async function prepareRouteMap(userId: string, routeId: number, deviceId: string | null) {
	const [route] = await db
		.select({ userId: savedRoute.userId, line: savedRoute.line })
		.from(savedRoute)
		.where(eq(savedRoute.id, routeId));
	if (!route) return null;
	if (route.userId !== userId) {
		const [order] = deviceId
			? await db
					.select({ state: routeMap.state })
					.from(routeMap)
					.where(and(eq(routeMap.routeId, routeId), eq(routeMap.deviceId, deviceId)))
			: [];
		if (!order) return null;
	}
	const version = await versionOf(route.line);
	const file = fileOf(routeId, version);
	if (!(await stat(file).catch(() => null))) {
		let job = cutting.get(file);
		if (!job) {
			job = cut(route.line, file).finally(() => cutting.delete(file));
			cutting.set(file, job);
		}
		await job;
		await forgetRouteMaps(routeId, file);
	}
	return {
		url: `/mapa/recorridos/${path.basename(file)}`,
		bytes: (await stat(file)).size,
		version
	};
}

// Devices.

/** Named on itself; again with another name, renamed. */
export async function saveMapDevice(id: string, name: string, userId: string) {
	await db
		.insert(mapDevice)
		.values({ id, name, createdBy: userId })
		.onConflictDoUpdate({ target: mapDevice.id, set: { name, lastSeenAt: new Date() } });
}

/** Forgotten from any device: its orders go with it; on it, what it kept, the next time it opens. */
export async function forgetMapDevice(id: string) {
	await db.delete(mapDevice).where(eq(mapDevice.id, id));
}

/**
 * The device, as the app opens on it: what it keeps, against what it was ordered. What it has to do
 * comes back; null, it is not known (forgotten from another device).
 */
export async function syncMapDevice(
	deviceId: string,
	held: HeldMap[]
): Promise<{ name: string; orders: DeviceOrder[] } | null> {
	const [device] = await db
		.update(mapDevice)
		.set({ lastSeenAt: new Date() })
		.where(eq(mapDevice.id, deviceId))
		.returning({ name: mapDevice.name });
	if (!device) return null;
	const rows = await db.select().from(routeMap).where(eq(routeMap.deviceId, deviceId));
	const orders: DeviceOrder[] = [];
	for (const row of rows) {
		const has = held.find((h) => h.routeId === row.routeId);
		if (row.state === 'remove') {
			if (has) orders.push({ routeId: row.routeId, action: 'remove' });
			else await removeRow(row.routeId, deviceId);
		} else if (row.state === 'pending' || row.state === 'downloading') {
			// Left halfway when the page closed: it goes on from where it was.
			orders.push({ routeId: row.routeId, action: 'download' });
		} else if (row.state === 'ready' && !has) {
			await report(deviceId, {
				routeId: row.routeId,
				state: 'failed',
				problem: 'Ya no está en el dispositivo: lo borró el navegador'
			});
		}
	}
	// Kept without an order: its route is gone, or it was ordered away.
	for (const h of held)
		if (!rows.some((r) => r.routeId === h.routeId))
			orders.push({ routeId: h.routeId, action: 'remove' });
	return { name: device.name, orders };
}

function removeRow(routeId: number, deviceId: string) {
	return db
		.delete(routeMap)
		.where(and(eq(routeMap.routeId, routeId), eq(routeMap.deviceId, deviceId)));
}

/** How it is going, as the device says: only for what it was ordered. */
export async function report(deviceId: string, r: RouteMapReport) {
	const where = and(eq(routeMap.routeId, r.routeId), eq(routeMap.deviceId, deviceId));
	if (r.state === 'removed') return void (await removeRow(r.routeId, deviceId));
	const [row] = await db.select({ state: routeMap.state }).from(routeMap).where(where);
	// Ordered away meanwhile: that stays.
	if (!row || row.state === 'remove') return;
	await db
		.update(routeMap)
		.set({
			state: r.state,
			progress: r.state === 'ready' ? 1 : (r.progress ?? 0),
			...(r.bytes !== undefined && { bytes: r.bytes }),
			...(r.version !== undefined && { version: r.version }),
			problem: r.state === 'failed' ? (r.problem ?? 'Error') : null,
			updatedAt: new Date()
		})
		.where(where);
}

// Orders, from any device.

async function ownRoute(userId: string, routeId: number) {
	const [route] = await db
		.select({ id: savedRoute.id })
		.from(savedRoute)
		.where(and(eq(savedRoute.id, routeId), eq(savedRoute.userId, userId)));
	return Boolean(route);
}

/** To download (or again: old, or failed). */
export async function orderDownload(userId: string, routeId: number, deviceId: string) {
	if (!(await ownRoute(userId, routeId))) return false;
	const values = { state: 'pending' as const, progress: 0, problem: null, updatedAt: new Date() };
	await db
		.insert(routeMap)
		.values({ routeId, deviceId, ...values })
		.onConflictDoUpdate({ target: [routeMap.routeId, routeMap.deviceId], set: values });
	return true;
}

/** Away: at once if it never got there; otherwise the device removes it when it opens. */
export async function orderRemove(userId: string, routeId: number, deviceId: string) {
	if (!(await ownRoute(userId, routeId))) return false;
	const where = and(eq(routeMap.routeId, routeId), eq(routeMap.deviceId, deviceId));
	const [row] = await db.select({ state: routeMap.state }).from(routeMap).where(where);
	if (!row) return true;
	// Not there: what it left halfway, it removes itself when it opens (nothing ordered for it).
	if (row.state === 'pending' || row.state === 'failed') await removeRow(routeId, deviceId);
	else await db.update(routeMap).set({ state: 'remove', updatedAt: new Date() }).where(where);
	return true;
}

/** The devices, and where this user's routes' maps are and how. */
export async function routeMapsOf(userId: string): Promise<RouteMapsView> {
	const [devices, routes] = await Promise.all([
		db
			.select({ id: mapDevice.id, name: mapDevice.name, lastSeenAt: mapDevice.lastSeenAt })
			.from(mapDevice)
			.orderBy(asc(mapDevice.name)),
		db
			.select({ id: savedRoute.id, line: savedRoute.line })
			.from(savedRoute)
			.where(eq(savedRoute.userId, userId))
	]);
	const rows = routes.length
		? await db
				.select()
				.from(routeMap)
				.where(
					inArray(
						routeMap.routeId,
						routes.map((r) => r.id)
					)
				)
		: [];
	const map = await stat(mapFile).catch(() => null);
	const current = new Map<number, string>();
	if (map) for (const r of routes) current.set(r.id, await versionOf(r.line));
	return {
		map: Boolean(map),
		devices,
		maps: rows.map((r) => ({
			routeId: r.routeId,
			deviceId: r.deviceId,
			state: r.state,
			progress: r.progress,
			bytes: r.bytes,
			problem: r.problem,
			old: r.state === 'ready' && r.version !== null && r.version !== current.get(r.routeId),
			updatedAt: r.updatedAt
		}))
	};
}
