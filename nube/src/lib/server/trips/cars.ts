import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { car, carDriver, trip, user } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { latestPlace, type CarPlace, type CarView } from '#lib/cars.ts';
import type { LngLat } from 'comun/road.ts';
import { who } from './trips.ts';

/**
 * The family's cars (#317), added in Ajustes → Casa: each person's own (car_driver), which their
 * trips go in, and where each one is, the end of its last trip or a later «Aquí y ahora».
 */

/** All of them, by name, with where they are. */
export async function listCars(k: Kitchen): Promise<CarView[]> {
	return k.run(async (tx) => {
		const cars = await tx
			.select({
				id: car.id,
				name: car.name,
				lon: car.lon,
				lat: car.lat,
				parkedAt: car.parkedAt,
				by: user.name,
				note: car.note
			})
			.from(car)
			.leftJoin(user, eq(user.id, car.parkedBy))
			.orderBy(car.name);
		if (!cars.length) return [];
		// Each car's last trip: where its last position was, and who drove.
		const trips = await tx
			.selectDistinctOn([trip.carId], {
				carId: trip.carId,
				endedAt: trip.endedAt,
				last: sql<[number, number, number] | null>`${trip.line} -> -1`,
				by: user.name
			})
			.from(trip)
			.leftJoin(user, eq(user.id, trip.userId))
			.where(isNotNull(trip.carId))
			.orderBy(trip.carId, desc(trip.startedAt));
		return cars.map((c) => {
			const t = trips.find((t) => t.carId === c.id);
			const marked: CarPlace | null =
				c.lon !== null && c.lat !== null && c.parkedAt
					? { at: [c.lon, c.lat], when: c.parkedAt, by: c.by, note: c.note, trip: false }
					: null;
			const ended: CarPlace | null = t?.last
				? { at: [t.last[0], t.last[1]], when: t.endedAt, by: t.by, note: null, trip: true }
				: null;
			return { id: c.id, name: c.name, place: latestPlace(marked, ended) };
		});
	});
}

/** Their car's id, if they said which. */
export async function myCarId(k: Kitchen) {
	const userId = who(k);
	const [row] = await k.run((tx) =>
		tx.select({ carId: carDriver.carId }).from(carDriver).where(eq(carDriver.userId, userId))
	);
	return row?.carId ?? null;
}

/** «El tuyo», in Ajustes: one of the family's, or none. */
export async function setMyCar(k: Kitchen, carId: number | null) {
	const userId = who(k);
	await k.run(async (tx) => {
		if (carId === null)
			return void (await tx.delete(carDriver).where(eq(carDriver.userId, userId)));
		const [found] = await tx.select({ id: car.id }).from(car).where(eq(car.id, carId));
		if (!found) return;
		await tx
			.insert(carDriver)
			.values({ familyId: k.familyId, userId, carId })
			.onConflictDoUpdate({ target: carDriver.userId, set: { carId } });
	});
}

/** A new one (no `id`), or its new name. The first one, of whoever adds it if they had none. */
export async function saveCar(k: Kitchen, id: number | null, name: string) {
	await k.run(async (tx) => {
		if (id !== null) return void (await tx.update(car).set({ name }).where(eq(car.id, id)));
		const [added] = await tx
			.insert(car)
			.values({ familyId: k.familyId, name })
			.returning({ id: car.id });
		if (k.userId)
			await tx
				.insert(carDriver)
				.values({ familyId: k.familyId, userId: k.userId, carId: added!.id })
				.onConflictDoNothing();
	});
}

/** Gone: its trips stay, without a car; whose it was, without one. */
export async function deleteCar(k: Kitchen, id: number) {
	await k.run((tx) => tx.delete(car).where(eq(car.id, id)));
}

/** «Aquí y ahora»: it is here, said by whoever asks, with a note if any. */
export async function parkCar(
	k: Kitchen,
	id: number,
	at: LngLat,
	accuracy: number | null,
	note: string | null
) {
	const userId = who(k);
	const [done] = await k.run((tx) =>
		tx
			.update(car)
			.set({
				lon: at[0],
				lat: at[1],
				accuracy,
				parkedAt: new Date(),
				parkedBy: userId,
				note
			})
			.where(eq(car.id, id))
			.returning({ id: car.id })
	);
	return Boolean(done);
}

/** The car one of their trips went in, or none (Viajes → Hechos). */
export async function setTripCar(k: Kitchen, tripId: number, carId: number | null) {
	const userId = who(k);
	await k.run(async (tx) => {
		if (carId !== null) {
			const [found] = await tx.select({ id: car.id }).from(car).where(eq(car.id, carId));
			if (!found) return;
		}
		await tx
			.update(trip)
			.set({ carId })
			.where(and(eq(trip.id, tripId), eq(trip.userId, userId)));
	});
}

/** Theirs, with where it is: for their home page. */
export async function myCar(k: Kitchen) {
	const id = await myCarId(k);
	if (id === null) return null;
	return (await listCars(k)).find((c) => c.id === id) ?? null;
}
