import { and, asc, eq } from 'drizzle-orm';
import { savedPlace, savedRoute } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { orsFor } from '#lib/server/road/ors.ts';
import type { LngLat } from 'comun/road.ts';
import type { RouteStop, SavedPlace, SavedRoute } from 'comun/saved-places.ts';
import { forgetRouteMaps } from './route-maps.ts';
import { who } from './trips.ts';

/**
 * Places and routes kept with their name (#151), each person's own. A route is calculated once,
 * when kept (and again if one of its places is moved), for its way on the map in Viajes, with the
 * family's openrouteservice key.
 */

export async function listSavedPlaces(k: Kitchen): Promise<SavedPlace[]> {
	const userId = who(k);
	const rows = await k.run((tx) =>
		tx.select().from(savedPlace).where(eq(savedPlace.userId, userId)).orderBy(asc(savedPlace.name))
	);
	return rows.map((r) => ({ id: r.id, name: r.name, at: [r.lon, r.lat], address: r.address }));
}

export async function listSavedRoutes(k: Kitchen): Promise<SavedRoute[]> {
	const userId = who(k);
	return k.run((tx) =>
		tx
			.select({
				id: savedRoute.id,
				name: savedRoute.name,
				stops: savedRoute.stops,
				line: savedRoute.line,
				distance: savedRoute.distance,
				duration: savedRoute.duration
			})
			.from(savedRoute)
			.where(eq(savedRoute.userId, userId))
			.orderBy(asc(savedRoute.name))
	);
}

/**
 * A new one, or that one changed (`id`). Moved, the routes through it follow it: their way is
 * asked again (kept as it was if openrouteservice cannot now).
 */
export async function savePlace(
	k: Kitchen,
	place: { id: number | null; name: string; at: LngLat; address: string | null }
) {
	const userId = who(k);
	const values = { name: place.name, lon: place.at[0], lat: place.at[1], address: place.address };
	if (place.id === null) {
		await k.run((tx) => tx.insert(savedPlace).values({ familyId: k.familyId, userId, ...values }));
		return;
	}
	const [updated] = await k.run((tx) =>
		tx
			.update(savedPlace)
			.set(values)
			.where(and(eq(savedPlace.id, place.id!), eq(savedPlace.userId, userId)))
			.returning({ id: savedPlace.id })
	);
	if (!updated) return;
	for (const route of await listSavedRoutes(k)) {
		if (!route.stops.some((s) => s.placeId === place.id)) continue;
		const moved = route.stops.some(
			(s) => s.placeId === place.id && (s.at[0] !== place.at[0] || s.at[1] !== place.at[1])
		);
		const stops = route.stops.map((s) =>
			s.placeId === place.id ? { ...s, name: place.name, at: place.at } : s
		);
		if (!moved) {
			await k.run((tx) => tx.update(savedRoute).set({ stops }).where(eq(savedRoute.id, route.id)));
			continue;
		}
		await saveRoute(k, { id: route.id, name: route.name, stops }).catch((error) =>
			console.warn('[rutas] No se pudo recalcular una ruta guardada al mover un sitio', {
				route: route.id,
				error
			})
		);
	}
}

/** Its routes keep the point, as a stop of their own. */
export async function deletePlace(k: Kitchen, id: number) {
	const userId = who(k);
	const [deleted] = await k.run((tx) =>
		tx
			.delete(savedPlace)
			.where(and(eq(savedPlace.id, id), eq(savedPlace.userId, userId)))
			.returning({ id: savedPlace.id })
	);
	if (!deleted) return;
	for (const route of await listSavedRoutes(k)) {
		if (!route.stops.some((s) => s.placeId === id)) continue;
		const stops = route.stops.map(({ placeId, ...s }) => (placeId === id ? s : { ...s, placeId }));
		await k.run((tx) => tx.update(savedRoute).set({ stops }).where(eq(savedRoute.id, route.id)));
	}
}

/** A new one, or that one changed (`id`): its way asked of openrouteservice; its errors, thrown. */
export async function saveRoute(
	k: Kitchen,
	route: { id: number | null; name: string; stops: RouteStop[] }
) {
	const userId = who(k);
	const way = await orsFor(k).drivingRoute(route.stops.map((s) => s.at));
	const values = {
		name: route.name,
		stops: route.stops,
		line: way.line,
		distance: way.distance,
		duration: way.duration
	};
	await k.run((tx) =>
		route.id === null
			? tx.insert(savedRoute).values({ familyId: k.familyId, userId, ...values })
			: tx
					.update(savedRoute)
					.set(values)
					.where(and(eq(savedRoute.id, route.id), eq(savedRoute.userId, userId)))
	);
}

/** Its maps cut for devices go too (#164); the devices remove theirs when they next open. */
export async function deleteRoute(k: Kitchen, id: number) {
	const userId = who(k);
	const [deleted] = await k.run((tx) =>
		tx
			.delete(savedRoute)
			.where(and(eq(savedRoute.id, id), eq(savedRoute.userId, userId)))
			.returning({ id: savedRoute.id })
	);
	if (deleted) await forgetRouteMaps(k.familyId, id);
}
