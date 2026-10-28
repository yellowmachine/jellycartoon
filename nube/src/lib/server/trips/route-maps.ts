import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import buffer from '@turf/buffer';
import { lineString } from '@turf/helpers';
import simplify from '@turf/simplify';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { MAP_DIR, ROUTE_MAPS_DIR } from '$app/env/private';
import { mapDevice, routeMap, savedRoute } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import type { LngLat } from 'comun/road.ts';
import type { DeviceOrder, HeldMap, RouteMapsView, RouteMapReport } from 'comun/route-maps.ts';

/**
 * Routes' maps for a device without coverage (#164): the strip of Spain's map around a route, cut
 * with go-pmtiles (`pmtiles extract --region`, https://docs.protomaps.com/pmtiles/cli), kept in
 * ROUTE_MAPS_DIR/<family> while it is current and served by /mapa/recorridos to that family only.
 * Ordered from any of the family's devices; the device that keeps it downloads and removes it when
 * the app opens on it.
 */

/** Kilometres each side of the way. */
const STRIP_KM = 5;
/** The way, simplified first: some 100 m off is nothing next to the strip. */
const SIMPLIFY_DEGREES = 0.001;
/** `pmtiles` in the image (Dockerfile); elsewhere, where PMTILES says. */
const PMTILES = process.env.PMTILES ?? 'pmtiles';
/** Spain's, as the road mode's map (scripts/mapa.sh). */
const mapFile = path.join(MAP_DIR, 'espana.pmtiles');

const run = promisify(execFile);

/** The family's own folder: its id, as made by the app (never a path). */
export function familyDir(familyId: string) {
	if (!/^[\w-]+$/.test(familyId)) throw new Error('Familia no válida');
	return path.join(path.resolve(ROUTE_MAPS_DIR), familyId);
}

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

const fileOf = (familyId: string, routeId: number, version: string) =>
	path.join(familyDir(familyId), `${routeId}-${version}.pmtiles`);

/** Cutting now, by file: asked twice, cut once. */
const cutting = new Map<string, Promise<void>>();

async function cut(line: LngLat[], file: string) {
	await mkdir(path.dirname(file), { recursive: true });
	const region = `${file}.geojson`;
	const part = `${file}.part`;
	await writeFile(region, JSON.stringify(strip(line)));
	const started = Date.now();
	try {
		await run(PMTILES, ['extract', mapFile, part, `--region=${region}`, '--quiet']);
		await rename(part, file);
		console.info(`[mapas] Mapa de un recorrido recortado: ${path.basename(file)}`, {
			bytes: (await stat(file)).size,
			ms: Date.now() - started
		});
	} finally {
		await rm(region, { force: true });
		await rm(part, { force: true });
	}
}

/** The route's maps other than this version (or all of them): no longer of use. */
export async function forgetRouteMaps(familyId: string, routeId: number, keep?: string) {
	const dir = familyDir(familyId);
	const names = await readdir(dir).catch(() => []);
	for (const name of names)
		if (name.startsWith(`${routeId}-`) && name !== (keep && path.basename(keep)))
			await rm(path.join(dir, name), { force: true });
}

/**
 * The route's map, cut if it is not yet: its address under /mapa, size and version. Its owner may
 * ask, or the device it was ordered for.
 */
export async function prepareRouteMap(k: Kitchen, routeId: number, deviceId: string | null) {
	const [route] = await k.run((tx) =>
		tx
			.select({ userId: savedRoute.userId, line: savedRoute.line })
			.from(savedRoute)
			.where(eq(savedRoute.id, routeId))
	);
	if (!route) return null;
	if (route.userId !== k.userId) {
		const [order] = deviceId
			? await k.run((tx) =>
					tx
						.select({ state: routeMap.state })
						.from(routeMap)
						.where(and(eq(routeMap.routeId, routeId), eq(routeMap.deviceId, deviceId)))
				)
			: [];
		if (!order) return null;
	}
	const version = await versionOf(route.line);
	const file = fileOf(k.familyId, routeId, version);
	if (!(await stat(file).catch(() => null))) {
		let job = cutting.get(file);
		if (!job) {
			job = cut(route.line, file).finally(() => cutting.delete(file));
			cutting.set(file, job);
		}
		await job;
		await forgetRouteMaps(k.familyId, routeId, file);
	}
	return {
		url: `/mapa/recorridos/${k.familyId}/${path.basename(file)}`,
		bytes: (await stat(file)).size,
		version
	};
}

// Devices.

/** Named on itself; again with another name, renamed. */
export async function saveMapDevice(k: Kitchen, id: string, name: string) {
	await k.run((tx) =>
		tx
			.insert(mapDevice)
			.values({ familyId: k.familyId, id, name, createdBy: k.userId })
			.onConflictDoUpdate({ target: mapDevice.id, set: { name, lastSeenAt: new Date() } })
	);
}

/** Forgotten from any device: its orders go with it; on it, what it kept, the next time it opens. */
export async function forgetMapDevice(k: Kitchen, id: string) {
	await k.run((tx) => tx.delete(mapDevice).where(eq(mapDevice.id, id)));
}

/**
 * The device, as the app opens on it: what it keeps, against what it was ordered. What it has to do
 * comes back; null, it is not known (forgotten from another device).
 */
export async function syncMapDevice(
	k: Kitchen,
	deviceId: string,
	held: HeldMap[]
): Promise<{ name: string; orders: DeviceOrder[] } | null> {
	const [device] = await k.run((tx) =>
		tx
			.update(mapDevice)
			.set({ lastSeenAt: new Date() })
			.where(eq(mapDevice.id, deviceId))
			.returning({ name: mapDevice.name })
	);
	if (!device) return null;
	const rows = await k.run((tx) =>
		tx.select().from(routeMap).where(eq(routeMap.deviceId, deviceId))
	);
	const orders: DeviceOrder[] = [];
	for (const row of rows) {
		const has = held.find((h) => h.routeId === row.routeId);
		if (row.state === 'remove') {
			if (has) orders.push({ routeId: row.routeId, action: 'remove' });
			else await removeRow(k, row.routeId, deviceId);
		} else if (row.state === 'pending' || row.state === 'downloading') {
			// Left halfway when the page closed: it goes on from where it was.
			orders.push({ routeId: row.routeId, action: 'download' });
		} else if (row.state === 'ready' && !has) {
			await report(k, deviceId, {
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

function removeRow(k: Kitchen, routeId: number, deviceId: string) {
	return k.run((tx) =>
		tx.delete(routeMap).where(and(eq(routeMap.routeId, routeId), eq(routeMap.deviceId, deviceId)))
	);
}

/** How it is going, as the device says: only for what it was ordered. */
export async function report(k: Kitchen, deviceId: string, r: RouteMapReport) {
	const where = and(eq(routeMap.routeId, r.routeId), eq(routeMap.deviceId, deviceId));
	const state = r.state;
	if (state === 'removed') return void (await removeRow(k, r.routeId, deviceId));
	await k.run(async (tx) => {
		const [row] = await tx.select({ state: routeMap.state }).from(routeMap).where(where);
		// Ordered away meanwhile: that stays.
		if (!row || row.state === 'remove') return;
		await tx
			.update(routeMap)
			.set({
				state,
				progress: state === 'ready' ? 1 : (r.progress ?? 0),
				...(r.bytes !== undefined && { bytes: r.bytes }),
				...(r.version !== undefined && { version: r.version }),
				problem: state === 'failed' ? (r.problem ?? 'Error') : null,
				updatedAt: new Date()
			})
			.where(where);
	});
}

// Orders, from any device.

async function ownRoute(k: Kitchen, routeId: number) {
	const [route] = await k.run((tx) =>
		tx
			.select({ id: savedRoute.id })
			.from(savedRoute)
			.where(and(eq(savedRoute.id, routeId), eq(savedRoute.userId, k.userId ?? '')))
	);
	return Boolean(route);
}

/** To download (or again: old, or failed). */
export async function orderDownload(k: Kitchen, routeId: number, deviceId: string) {
	if (!(await ownRoute(k, routeId))) return false;
	const values = { state: 'pending' as const, progress: 0, problem: null, updatedAt: new Date() };
	await k.run((tx) =>
		tx
			.insert(routeMap)
			.values({ familyId: k.familyId, routeId, deviceId, ...values })
			.onConflictDoUpdate({ target: [routeMap.routeId, routeMap.deviceId], set: values })
	);
	return true;
}

/** Away: at once if it never got there; otherwise the device removes it when it opens. */
export async function orderRemove(k: Kitchen, routeId: number, deviceId: string) {
	if (!(await ownRoute(k, routeId))) return false;
	const where = and(eq(routeMap.routeId, routeId), eq(routeMap.deviceId, deviceId));
	const [row] = await k.run((tx) =>
		tx.select({ state: routeMap.state }).from(routeMap).where(where)
	);
	if (!row) return true;
	// Not there: what it left halfway, it removes itself when it opens (nothing ordered for it).
	if (row.state === 'pending' || row.state === 'failed') await removeRow(k, routeId, deviceId);
	else
		await k.run((tx) =>
			tx.update(routeMap).set({ state: 'remove', updatedAt: new Date() }).where(where)
		);
	return true;
}

/** The family's devices, and where this person's routes' maps are and how. */
export async function routeMapsOf(k: Kitchen): Promise<RouteMapsView> {
	const [devices, routes] = await Promise.all([
		k.run((tx) =>
			tx
				.select({ id: mapDevice.id, name: mapDevice.name, lastSeenAt: mapDevice.lastSeenAt })
				.from(mapDevice)
				.orderBy(asc(mapDevice.name))
		),
		k.run((tx) =>
			tx
				.select({ id: savedRoute.id, line: savedRoute.line })
				.from(savedRoute)
				.where(eq(savedRoute.userId, k.userId ?? ''))
		)
	]);
	const rows = routes.length
		? await k.run((tx) =>
				tx
					.select()
					.from(routeMap)
					.where(
						inArray(
							routeMap.routeId,
							routes.map((r) => r.id)
						)
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
