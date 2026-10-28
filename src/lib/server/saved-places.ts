import { and, asc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { savedPlace, savedRoute } from '#lib/server/db/schema.ts';
import { log } from '#lib/server/log.ts';
import { drivingRoute } from '#lib/server/road/ors.ts';
import { forgetRouteMaps } from '#lib/server/route-maps.ts';
import type { LngLat } from 'comun/road.ts';
import type { RouteStop, SavedPlace, SavedRoute } from 'comun/saved-places.ts';

/**
 * Places and routes kept with their name (#151), each user's own. A route is calculated once, when
 * kept (and again if one of its places is moved), for its way on the map in Viajes.
 */

export async function listSavedPlaces(userId: string): Promise<SavedPlace[]> {
	const rows = await db
		.select()
		.from(savedPlace)
		.where(eq(savedPlace.userId, userId))
		.orderBy(asc(savedPlace.name));
	return rows.map((r) => ({ id: r.id, name: r.name, at: [r.lon, r.lat], address: r.address }));
}

export async function listSavedRoutes(userId: string): Promise<SavedRoute[]> {
	return db
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
		.orderBy(asc(savedRoute.name));
}

/** Whether there is any: Viajes is offered then too. */
export async function hasSaved(userId: string) {
	const [place] = await db
		.select({ id: savedPlace.id })
		.from(savedPlace)
		.where(eq(savedPlace.userId, userId))
		.limit(1);
	if (place) return true;
	const [route] = await db
		.select({ id: savedRoute.id })
		.from(savedRoute)
		.where(eq(savedRoute.userId, userId))
		.limit(1);
	return Boolean(route);
}

/**
 * A new one, or that one changed (`id`). Moved, the routes through it follow it: their way is
 * asked again (kept as it was if openrouteservice cannot now).
 */
export async function savePlace(
	userId: string,
	place: { id: number | null; name: string; at: LngLat; address: string | null }
) {
	const values = { name: place.name, lon: place.at[0], lat: place.at[1], address: place.address };
	if (place.id === null) {
		await db.insert(savedPlace).values({ userId, ...values });
		return;
	}
	const [updated] = await db
		.update(savedPlace)
		.set(values)
		.where(and(eq(savedPlace.id, place.id), eq(savedPlace.userId, userId)))
		.returning({ id: savedPlace.id });
	if (!updated) return;
	for (const route of await listSavedRoutes(userId)) {
		if (!route.stops.some((s) => s.placeId === place.id)) continue;
		const moved = route.stops.some(
			(s) => s.placeId === place.id && (s.at[0] !== place.at[0] || s.at[1] !== place.at[1])
		);
		const stops = route.stops.map((s) =>
			s.placeId === place.id ? { ...s, name: place.name, at: place.at } : s
		);
		if (!moved) {
			await db.update(savedRoute).set({ stops }).where(eq(savedRoute.id, route.id));
			continue;
		}
		await saveRoute(userId, { id: route.id, name: route.name, stops }).catch((error) =>
			log.warn('rutas', 'No se pudo recalcular una ruta guardada al mover un sitio', {
				route: route.id,
				error
			})
		);
	}
}

/** Its routes keep the point, as a stop of their own. */
export async function deletePlace(userId: string, id: number) {
	const [deleted] = await db
		.delete(savedPlace)
		.where(and(eq(savedPlace.id, id), eq(savedPlace.userId, userId)))
		.returning({ id: savedPlace.id });
	if (!deleted) return;
	for (const route of await listSavedRoutes(userId)) {
		if (!route.stops.some((s) => s.placeId === id)) continue;
		const stops = route.stops.map(({ placeId, ...s }) => (placeId === id ? s : { ...s, placeId }));
		await db.update(savedRoute).set({ stops }).where(eq(savedRoute.id, route.id));
	}
}

/** A new one, or that one changed (`id`): its way asked of openrouteservice; its errors, thrown. */
export async function saveRoute(
	userId: string,
	route: { id: number | null; name: string; stops: RouteStop[] }
) {
	const way = await drivingRoute(route.stops.map((s) => s.at));
	const values = {
		name: route.name,
		stops: route.stops,
		line: way.line,
		distance: way.distance,
		duration: way.duration
	};
	if (route.id === null) await db.insert(savedRoute).values({ userId, ...values });
	else
		await db
			.update(savedRoute)
			.set(values)
			.where(and(eq(savedRoute.id, route.id), eq(savedRoute.userId, userId)));
}

/** Its maps cut for devices go too (#164); the devices remove theirs when they next open. */
export async function deleteRoute(userId: string, id: number) {
	const [deleted] = await db
		.delete(savedRoute)
		.where(and(eq(savedRoute.id, id), eq(savedRoute.userId, userId)))
		.returning({ id: savedRoute.id });
	if (deleted) await forgetRouteMaps(id);
}
