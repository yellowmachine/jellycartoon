import { asc, eq, inArray } from 'drizzle-orm';
import { localDay } from 'comun/agenda.ts';
import type { RouteStop } from 'comun/saved-places.ts';
import type { LngLat } from 'comun/road.ts';
import { warningsOf, wayPoints, wayWeather } from 'comun/route-weather.ts';
import { FORECAST_DAYS, hourWeather } from 'comun/weather.ts';
import { addEvent, deleteEvent, personOf, updateEvent } from '#lib/server/agenda/agenda.ts';
import { plannedLeg, plannedTrip, plannedTripPerson } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { orsFor } from '#lib/server/road/ors.ts';
import {
	arrivalOf,
	HOME_DAYS,
	tripOver,
	type LegWeather,
	type PlannedLeg,
	type PlannedTrip,
	type TripWarning
} from '#lib/planned-trips.ts';
import { who } from './trips.ts';

/**
 * Trips still to come (Viajes → Próximos): the family's, or only its maker's («Solo para mí»), with
 * who goes and their legs, each with its day, its time and its own copy of the way by car. A
 * family's trip has each leg in the Agenda, for who goes, with its notice the day before.
 */

type LegRow = typeof plannedLeg.$inferSelect;

const asLeg = (r: LegRow): PlannedLeg => ({
	id: r.id,
	day: r.day,
	time: r.time.slice(0, 5),
	from: r.stops[0]?.name ?? 'Salida',
	to: r.stops.at(-1)?.name ?? 'Llegada',
	start: r.stops[0]!.at,
	end: r.stops.at(-1)!.at,
	distance: r.distance,
	duration: r.duration
});

/** The trips this person sees: the family's, and their own private ones. Soonest first. */
export async function listPlannedTrips(k: Kitchen): Promise<PlannedTrip[]> {
	// No one known (a satellite's voice, #347): only the family's.
	const me = k.userId;
	const rows = await k.run(async (tx) => {
		const trips = await tx.select().from(plannedTrip).orderBy(asc(plannedTrip.createdAt));
		const ids = trips.map((t) => t.id);
		const [legs, people] = ids.length
			? await Promise.all([
					tx
						.select()
						.from(plannedLeg)
						.where(inArray(plannedLeg.tripId, ids))
						.orderBy(asc(plannedLeg.day), asc(plannedLeg.time)),
					tx.select().from(plannedTripPerson).where(inArray(plannedTripPerson.tripId, ids))
				])
			: [[], []];
		return { trips, legs, people };
	});
	const trips = rows.trips
		.filter((t) => !t.private || (me !== null && t.userId === me))
		.map((t) => ({
			id: t.id,
			name: t.name,
			private: t.private,
			mine: me !== null && t.userId === me,
			people: rows.people.filter((p) => p.tripId === t.id).map((p) => String(p.personId)),
			legs: rows.legs.filter((l) => l.tripId === t.id).map(asLeg)
		}));
	// Without legs yet, last; the others by their first leg.
	const first = (t: PlannedTrip) => (t.legs[0] ? `${t.legs[0].day} ${t.legs[0].time}` : '~');
	return trips.sort((a, b) => first(a).localeCompare(first(b)));
}

/** The trip, if this person may change it: a family's, anyone of it; a private one, its maker. */
async function tripFor(k: Kitchen, id: number) {
	const me = who(k);
	const [row] = await k.run((tx) => tx.select().from(plannedTrip).where(eq(plannedTrip.id, id)));
	return row && (!row.private || row.userId === me) ? row : null;
}

/** Only the family's people: an id that is not, left out (RLS keeps the rest out). */
const personIds = (people: string[]) => people.map(Number).filter(Number.isInteger);

/** A new trip, or its name, who goes and whether it is private. Its id; null, not one they see. */
export async function saveTrip(
	k: Kitchen,
	trip: { id: number | null; name: string; private: boolean; people: string[] }
) {
	const me = who(k);
	if (trip.id !== null && !(await tripFor(k, trip.id))) return null;
	const id = await k.run(async (tx) => {
		const values = { name: trip.name, private: trip.private };
		const [row] =
			trip.id === null
				? await tx
						.insert(plannedTrip)
						.values({ ...values, familyId: k.familyId, userId: me })
						.returning({ id: plannedTrip.id })
				: await tx
						.update(plannedTrip)
						.set(values)
						.where(eq(plannedTrip.id, trip.id))
						.returning({ id: plannedTrip.id });
		await tx.delete(plannedTripPerson).where(eq(plannedTripPerson.tripId, row!.id));
		const ids = personIds(trip.people);
		if (ids.length)
			await tx
				.insert(plannedTripPerson)
				.values(ids.map((personId) => ({ familyId: k.familyId, tripId: row!.id, personId })))
				.onConflictDoNothing();
		return row!.id;
	});
	await syncAgenda(k, id);
	return id;
}

export async function deleteTrip(k: Kitchen, id: number) {
	if (!(await tripFor(k, id))) return false;
	const legs = await k.run((tx) =>
		tx.select({ eventId: plannedLeg.eventId }).from(plannedLeg).where(eq(plannedLeg.tripId, id))
	);
	for (const { eventId } of legs) if (eventId) await deleteEvent(k, eventId);
	await k.run((tx) => tx.delete(plannedTrip).where(eq(plannedTrip.id, id)));
	return true;
}

/**
 * A new leg: its way by car between its stops, with the family's openrouteservice key. Throws if
 * it cannot be calculated (orsMessage, for people). False if the trip is not one they may change.
 */
export async function addLeg(
	k: Kitchen,
	tripId: number,
	leg: { day: string; time: string; stops: RouteStop[] }
) {
	if (!(await tripFor(k, tripId))) return false;
	const way = await orsFor(k).drivingRoute(leg.stops.map((s) => s.at));
	await k.run((tx) =>
		tx.insert(plannedLeg).values({
			familyId: k.familyId,
			tripId,
			day: leg.day,
			time: leg.time,
			stops: leg.stops,
			line: way.line,
			distance: way.distance,
			duration: way.duration
		})
	);
	await syncAgenda(k, tripId);
	return true;
}

/** Its day and time, changed; its way stays. */
export async function moveLeg(k: Kitchen, id: number, day: string, time: string) {
	const tripId = await tripOfLeg(k, id);
	if (tripId === null) return false;
	await k.run((tx) => tx.update(plannedLeg).set({ day, time }).where(eq(plannedLeg.id, id)));
	await syncAgenda(k, tripId);
	return true;
}

export async function deleteLeg(k: Kitchen, id: number) {
	const tripId = await tripOfLeg(k, id);
	if (tripId === null) return false;
	const [gone] = await k.run((tx) =>
		tx.delete(plannedLeg).where(eq(plannedLeg.id, id)).returning({ eventId: plannedLeg.eventId })
	);
	if (gone?.eventId) await deleteEvent(k, gone.eventId);
	return true;
}

/** Its trip's id, if this person may change it; null otherwise. */
async function tripOfLeg(k: Kitchen, id: number) {
	const [row] = await k.run((tx) =>
		tx.select({ tripId: plannedLeg.tripId }).from(plannedLeg).where(eq(plannedLeg.id, id))
	);
	return row && (await tripFor(k, row.tripId)) ? row.tripId : null;
}

/**
 * Each leg of a family's trip in the Agenda, as it is now: «🚗 Puente en Asturias: Toledo →
 * Oviedo», for who goes, from when it leaves to when it arrives, told the day before. A private
 * trip's, out of it: the Agenda has nothing private.
 */
async function syncAgenda(k: Kitchen, tripId: number) {
	const [trip] = await k.run((tx) =>
		tx.select().from(plannedTrip).where(eq(plannedTrip.id, tripId))
	);
	if (!trip) return;
	const [legs, people] = await k.run((tx) =>
		Promise.all([
			tx.select().from(plannedLeg).where(eq(plannedLeg.tripId, tripId)),
			tx.select().from(plannedTripPerson).where(eq(plannedTripPerson.tripId, tripId))
		])
	);
	for (const row of legs) {
		const leg = asLeg(row);
		if (trip.private) {
			if (row.eventId) {
				await deleteEvent(k, row.eventId);
				await setEvent(k, row.id, null);
			}
			continue;
		}
		const arrival = arrivalOf(leg);
		const input = {
			title: `🚗 ${trip.name}: ${leg.from} → ${leg.to}`,
			notes: null,
			startDay: leg.day,
			startTime: leg.time,
			endDay: arrival.day > leg.day ? arrival.day : null,
			endTime: arrival.time,
			repeat: { every: null } as const,
			remind: 'dia' as const,
			people: people.map((p) => String(p.personId))
		};
		if (row.eventId && (await updateEvent(k, row.eventId, input))) continue;
		await setEvent(k, row.id, await addEvent(k, input));
	}
}

const setEvent = (k: Kitchen, legId: number, eventId: number | null) =>
	k.run((tx) => tx.update(plannedLeg).set({ eventId }).where(eq(plannedLeg.id, legId)));

/** Open-Meteo's, kept a while for each place and hour: Viajes and the home page are opened often. */
const WEATHER_MS = 30 * 60_000;
const weathers = new Map<string, { at: number; weather: Promise<LegWeather['depart']> }>();

function weatherAt(at: [number, number], day: string, time: string) {
	const today = localDay();
	const hour = Number(time.slice(0, 2));
	const key = `${at[0].toFixed(2)},${at[1].toFixed(2)},${day},${hour}`;
	const kept = weathers.get(key);
	if (kept && Date.now() - kept.at < WEATHER_MS) return kept.weather;
	const weather = hourWeather(at[1], at[0], day, hour, today).catch((error) => {
		console.warn('[viajes] Sin el tiempo', String(error));
		weathers.delete(key);
		return null;
	});
	weathers.set(key, { at: Date.now(), weather });
	return weather;
}

/** The towns warnings start near, kept: a point on a road keeps its nearest town. */
const towns = new Map<string, Promise<string | null>>();

function townAt(k: Kitchen, at: LngLat) {
	const key = `${at[0].toFixed(2)},${at[1].toFixed(2)}`;
	let town = towns.get(key);
	if (!town) {
		town = orsFor(k)
			.townNear(at)
			.catch((error) => {
				console.warn('[viajes] Sin el pueblo de un aviso', String(error));
				towns.delete(key);
				return null;
			});
		towns.set(key, town);
	}
	return town;
}

/** Along its way, what to beware of, kept a while; null, too far ahead or it could not be looked at. */
const ways = new Map<string, { at: number; warnings: Promise<TripWarning[] | null> }>();

function wayAt(k: Kitchen, leg: PlannedLeg, line: LngLat[]) {
	const today = localDay();
	const last = new Date(`${today}T12:00:00Z`);
	last.setUTCDate(last.getUTCDate() + FORECAST_DAYS - 1);
	const arrival = arrivalOf(leg);
	if (arrival.day < today || leg.day > last.toISOString().slice(0, 10)) return null;
	const key = `${leg.id},${leg.day},${leg.time}`;
	const kept = ways.get(key);
	if (kept && Date.now() - kept.at < WEATHER_MS) return kept.warnings;
	const points = wayPoints(line, new Date(`${leg.day}T${leg.time}:00`).getTime(), leg.duration);
	const warnings = wayWeather(points)
		.then((weather) => warningsOf(points, weather))
		.then((found) => Promise.all(found.map(async (w) => ({ ...w, town: await townAt(k, w.at) }))))
		.catch((error) => {
			console.warn('[viajes] Sin el tiempo del camino', String(error));
			ways.delete(key);
			return null;
		});
	ways.set(key, { at: Date.now(), warnings });
	return warnings;
}

/** Each leg's way by car, by its id. */
async function linesOf(k: Kitchen, ids: number[]) {
	if (!ids.length) return new Map<number, LngLat[]>();
	const rows = await k.run((tx) =>
		tx
			.select({ id: plannedLeg.id, line: plannedLeg.line })
			.from(plannedLeg)
			.where(inArray(plannedLeg.id, ids))
	);
	return new Map(rows.map((r) => [r.id, r.line]));
}

/**
 * Where it leaves when it leaves, where it arrives when it arrives, and along its way; null for
 * each, too far ahead yet.
 */
export async function legWeather(k: Kitchen, leg: PlannedLeg, line: LngLat[]): Promise<LegWeather> {
	const arrival = arrivalOf(leg);
	const [depart, arrive, way] = await Promise.all([
		weatherAt(leg.start, leg.day, leg.time),
		weatherAt(leg.end, arrival.day, arrival.time),
		wayAt(k, leg, line)
	]);
	return { depart, arrive, way };
}

/** Each leg's weather, by its id, for Viajes: only those not over. */
export async function tripsWeather(k: Kitchen, trips: PlannedTrip[]) {
	const today = localDay();
	const legs = trips.flatMap((t) => t.legs).filter((l) => arrivalOf(l).day >= today);
	const lines = await linesOf(
		k,
		legs.map((l) => l.id)
	);
	const all = await Promise.all(
		legs.map(async (l) => [l.id, await legWeather(k, l, lines.get(l.id) ?? [])] as const)
	);
	return Object.fromEntries(all) as Record<number, LegWeather>;
}

/**
 * This person's next trip, for the home page: one they go on (or everyone's, if it says no one),
 * whose next leg leaves within `HOME_DAYS` days or is on its way now. That leg and its weather, and
 * the one after it (the way back).
 */
export async function nextTrip(k: Kitchen) {
	const me = k.userId ? await personOf(k, k.userId) : null;
	const now = new Date();
	const today = localDay(now);
	const until = new Date(now);
	until.setDate(until.getDate() + HOME_DAYS);
	for (const trip of await listPlannedTrips(k)) {
		if (tripOver(trip, today)) continue;
		if (trip.people.length && (me === null || !trip.people.includes(me))) continue;
		const i = trip.legs.findIndex((l) => {
			const a = arrivalOf(l);
			return new Date(`${a.day}T${a.time}:00`) > now;
		});
		const leg = trip.legs[i];
		if (!leg || new Date(`${leg.day}T${leg.time}:00`) > until) continue;
		return {
			trip: { id: trip.id, name: trip.name },
			leg,
			weather: await legWeather(k, leg, (await linesOf(k, [leg.id])).get(leg.id) ?? []),
			then: trip.legs[i + 1] ?? null
		};
	}
	return null;
}

/** A kept route of theirs, as a leg's stops: its own copy goes in the trip. */
export function stopsOf(stops: RouteStop[]) {
	return stops.map(({ name, at }) => ({ name, at }));
}
