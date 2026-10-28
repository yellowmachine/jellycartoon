import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { familyMember, trip } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { addPoints, NEW_TRIP_AFTER_MS, type TripPoint } from '#lib/trips.ts';

/**
 * The road mode's trips (#81), kept for whoever turned it on: the browser sends its positions in
 * batches, and they go on the last trip, or start another after a long stop.
 */

/** Who asks: a person of the family (their own trips). */
export function who(k: Kitchen) {
	if (!k.userId) throw new Error('Los viajes son de cada persona');
	return k.userId;
}

export async function recordsTrips(k: Kitchen) {
	const userId = who(k);
	const [row] = await k.run((tx) =>
		tx
			.select({ on: familyMember.recordTrips })
			.from(familyMember)
			.where(eq(familyMember.userId, userId))
	);
	return row?.on ?? false;
}

/** «Guardar mis viajes», in Ajustes: off deletes nothing already kept. */
export async function setRecordTrips(k: Kitchen, on: boolean) {
	const userId = who(k);
	await k.run((tx) =>
		tx.update(familyMember).set({ recordTrips: on }).where(eq(familyMember.userId, userId))
	);
}

/** A batch of positions, onto the last trip or a new one. */
export async function addTripPoints(k: Kitchen, points: TripPoint[], destination: string | null) {
	const userId = who(k);
	if (!points.length) return;
	const first = Math.min(...points.map((p) => p.t));
	await k.run(async (tx) => {
		const [last] = await tx
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
			await tx
				.update(trip)
				.set({
					endedAt,
					distance: sql`${trip.distance} + ${distance}`,
					maxSpeed:
						maxSpeed === null ? trip.maxSpeed : sql`greatest(${trip.maxSpeed}, ${maxSpeed})`,
					// A route set on the way says where it went.
					...(destination ? { destination } : {}),
					line: sql`${trip.line} || ${JSON.stringify(kept)}::jsonb`
				})
				.where(eq(trip.id, last.id));
		} else {
			await tx.insert(trip).values({
				familyId: k.familyId,
				userId,
				startedAt: new Date(kept[0]![2] * 1000),
				endedAt,
				distance,
				maxSpeed,
				destination,
				line: kept
			});
		}
	});
}

/** The trips, the latest first, without their positions. */
export async function listTrips(k: Kitchen, limit = 100) {
	const userId = who(k);
	return k.run((tx) =>
		tx
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
			.limit(limit)
	);
}

/** One trip's positions, to draw it. */
export async function tripLine(k: Kitchen, id: number) {
	const userId = who(k);
	const [row] = await k.run((tx) =>
		tx
			.select({ line: trip.line })
			.from(trip)
			.where(and(eq(trip.id, id), eq(trip.userId, userId)))
	);
	return row?.line ?? null;
}

/** By month, the last twelve: trips, metres and seconds at the wheel. In the server's time zone. */
export async function tripStats(k: Kitchen) {
	const userId = who(k);
	const since = new Date();
	since.setMonth(since.getMonth() - 11, 1);
	since.setHours(0, 0, 0, 0);
	const month = sql<string>`to_char(${trip.startedAt}, 'YYYY-MM')`;
	return k.run((tx) =>
		tx
			.select({
				month,
				trips: sql<number>`count(*)::int`,
				distance: sql<number>`coalesce(sum(${trip.distance}), 0)::real`,
				seconds: sql<number>`coalesce(sum(extract(epoch from ${trip.endedAt} - ${trip.startedAt})), 0)::real`
			})
			.from(trip)
			.where(and(eq(trip.userId, userId), gte(trip.startedAt, since)))
			.groupBy(month)
			.orderBy(desc(month))
	);
}

/** One, or all of them with null. */
export async function deleteTrips(k: Kitchen, id: number | null) {
	const userId = who(k);
	await k.run((tx) =>
		tx
			.delete(trip)
			.where(id === null ? eq(trip.userId, userId) : and(eq(trip.userId, userId), eq(trip.id, id)))
	);
}
