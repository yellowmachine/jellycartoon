import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { trip, userSettings } from '#lib/server/db/schema.ts';
import { addPoints, NEW_TRIP_AFTER_MS, type TripPoint } from '#lib/trips.ts';
import { hasSaved } from '#lib/server/saved-places.ts';

/**
 * The road mode's trips (#81), kept for whoever turned it on: the browser sends its positions in
 * batches, and they go on the last trip, or start another after a long stop.
 */

export async function recordsTrips(userId: string) {
	const [row] = await db
		.select({ on: userSettings.recordTrips })
		.from(userSettings)
		.where(eq(userSettings.userId, userId));
	return row?.on ?? false;
}

/**
 * Whether «Mis viajes» is offered (road mode, Música, Radio): trips kept, or being kept, or places
 * and routes kept there (#151).
 */
export async function hasTripsPage(userId: string) {
	if (await recordsTrips(userId)) return true;
	if (await hasSaved(userId)) return true;
	const [found] = await db
		.select({ id: trip.id })
		.from(trip)
		.where(eq(trip.userId, userId))
		.limit(1);
	return Boolean(found);
}

/** «Guardar mis viajes», in Ajustes: off deletes nothing already kept. */
export async function setRecordTrips(userId: string, on: boolean) {
	await db
		.insert(userSettings)
		.values({ userId, recordTrips: on })
		.onConflictDoUpdate({ target: userSettings.userId, set: { recordTrips: on } });
}

/** A batch of positions, onto the last trip or a new one. */
export async function addTripPoints(
	userId: string,
	points: TripPoint[],
	destination: string | null
) {
	if (!points.length) return;
	const first = Math.min(...points.map((p) => p.t));
	const [last] = await db
		.select({
			id: trip.id,
			endedAt: trip.endedAt,
			lastPoint: sql<[number, number, number] | null>`${trip.line} -> -1`
		})
		.from(trip)
		.where(eq(trip.userId, userId))
		.orderBy(desc(trip.startedAt))
		.limit(1);
	const goesOn = last && first - last.endedAt.getTime() <= NEW_TRIP_AFTER_MS;
	const { kept, distance, maxSpeed } = addPoints(goesOn ? last.lastPoint : null, points);
	if (!kept.length) return;
	const endedAt = new Date(kept.at(-1)![2] * 1000);
	if (goesOn) {
		await db
			.update(trip)
			.set({
				endedAt,
				distance: sql`${trip.distance} + ${distance}`,
				maxSpeed: maxSpeed === null ? trip.maxSpeed : sql`greatest(${trip.maxSpeed}, ${maxSpeed})`,
				// A route set on the way says where it went.
				...(destination ? { destination } : {}),
				line: sql`${trip.line} || ${JSON.stringify(kept)}::jsonb`
			})
			.where(eq(trip.id, last.id));
	} else {
		await db.insert(trip).values({
			userId,
			startedAt: new Date(kept[0]![2] * 1000),
			endedAt,
			distance,
			maxSpeed,
			destination,
			line: kept
		});
	}
}

/** The trips, the latest first, without their positions. */
export async function listTrips(userId: string, limit = 100) {
	return db
		.select({
			id: trip.id,
			startedAt: trip.startedAt,
			endedAt: trip.endedAt,
			distance: trip.distance,
			maxSpeed: trip.maxSpeed,
			destination: trip.destination
		})
		.from(trip)
		.where(eq(trip.userId, userId))
		.orderBy(desc(trip.startedAt))
		.limit(limit);
}

/** One trip's positions, to draw it. */
export async function tripLine(userId: string, id: number) {
	const [row] = await db
		.select({ line: trip.line })
		.from(trip)
		.where(and(eq(trip.id, id), eq(trip.userId, userId)));
	return row?.line ?? null;
}

/** By month, the last twelve: trips, metres and seconds at the wheel. In the server's time zone. */
export async function tripStats(userId: string) {
	const since = new Date();
	since.setMonth(since.getMonth() - 11, 1);
	since.setHours(0, 0, 0, 0);
	const month = sql<string>`to_char(${trip.startedAt}, 'YYYY-MM')`;
	return db
		.select({
			month,
			trips: sql<number>`count(*)::int`,
			distance: sql<number>`coalesce(sum(${trip.distance}), 0)::real`,
			seconds: sql<number>`coalesce(sum(extract(epoch from ${trip.endedAt} - ${trip.startedAt})), 0)::real`
		})
		.from(trip)
		.where(and(eq(trip.userId, userId), gte(trip.startedAt, since)))
		.groupBy(month)
		.orderBy(desc(month));
}

/** One, or all of them with null. */
export async function deleteTrips(userId: string, id: number | null) {
	await db
		.delete(trip)
		.where(id === null ? eq(trip.userId, userId) : and(eq(trip.userId, userId), eq(trip.id, id)));
}
