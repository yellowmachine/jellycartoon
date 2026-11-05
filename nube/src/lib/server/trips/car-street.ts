import { isMoving, type CarView } from '#lib/cars.ts';
import type { LngLat } from 'comun/road.ts';

/**
 * The street a car is in, for the home page (#317). A street does not move: each point is asked
 * once while the server lives, as each look at the home page would spend the family's free quota.
 * Not saved with the car, as a trip's end has nowhere to keep it.
 */

const MAX_KEPT = 1000;
const WAIT_MS = 3000;

const streets = new Map<string, string | null>();

async function streetAt(at: LngLat, near: (at: LngLat) => Promise<string | null>) {
	const key = at.map((n) => n.toFixed(5)).join();
	if (streets.has(key)) return streets.get(key)!;
	const street = await near(at);
	if (streets.size >= MAX_KEPT) streets.delete(streets.keys().next().value!);
	streets.set(key, street);
	return street;
}

/**
 * The car with its street, if `near` knows it in time. Without it, the card as ever: late, its
 * answer stays for the next look. Not while it is moving: each position would be a new question.
 */
export async function carWithStreet(
	car: CarView | null,
	near: (at: LngLat) => Promise<string | null>,
	wait = WAIT_MS
) {
	if (!car?.place || isMoving(car.place, new Date())) return car;
	const asked = streetAt(car.place.at, near).catch((error) => {
		console.warn('[coche] Sin la calle', String(error));
		return null;
	});
	const street = await Promise.race([
		asked,
		new Promise<null>((resolve) => setTimeout(() => resolve(null), wait))
	]);
	return { ...car, place: { ...car.place, street } };
}
