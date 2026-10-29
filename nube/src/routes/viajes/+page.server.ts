import { access } from 'node:fs/promises';
import path from 'node:path';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { MAP_DIR } from '$app/env/private';
import { kitchenOf } from '#lib/server/fridge.ts';
import { orsFor } from '#lib/server/road/ors.ts';
import {
	addLeg,
	deleteLeg,
	deleteTrip,
	listPlannedTrips,
	moveLeg,
	saveTrip,
	stopsOf,
	tripsWeather
} from '#lib/server/trips/planned.ts';
import { agendaPeople } from '#lib/server/agenda/agenda.ts';
import { isDay, isTime } from 'comun/agenda.ts';
import { MAX_TRIP_NAME } from '#lib/planned-trips.ts';
import {
	deletePlace,
	deleteRoute,
	listSavedPlaces,
	listSavedRoutes,
	savePlace,
	saveRoute
} from '#lib/server/trips/places.ts';
import {
	forgetMapDevice,
	orderDownload,
	orderRemove,
	routeMapsOf
} from '#lib/server/trips/route-maps.ts';
import { isDeviceId } from 'comun/route-maps.ts';
import { fold } from 'comun/music.ts';
import { isLngLat } from 'comun/road.ts';
import { MAX_STOPS, type RouteStop } from 'comun/saved-places.ts';

const MAX_NAME = 60;

/** The form's `id`: a number, or none (a new one). */
function idOf(form: FormData) {
	const raw = form.get('id');
	if (raw === null || raw === '') return null;
	const id = Number(raw);
	return Number.isInteger(id) ? id : undefined;
}

/** Its name, trimmed; none, or one already used (accents and case aside): why not. */
function nameOf(form: FormData, used: { id: number; name: string }[], id: number | null) {
	const name = String(form.get('name') ?? '')
		.trim()
		.replace(/\s+/g, ' ');
	if (!name) return { problem: 'Falta el nombre' };
	if (name.length > MAX_NAME) return { problem: `El nombre, como mucho de ${MAX_NAME} letras` };
	if (used.some((u) => u.id !== id && fold(u.name) === fold(name)))
		return { problem: `Ya hay uno que se llama «${name}»` };
	return { name };
}

/**
 * Viajes → Próximos: the trips still to come (planned.ts), with each leg's weather after the page
 * (Open-Meteo); and the places and routes kept with their name, for the road mode (#151) and the
 * trips' legs. Those made, in /viajes/hechos.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const [planned, people, map, places, routes, routeMaps] = await Promise.all([
		listPlannedTrips(k),
		agendaPeople(k),
		access(path.join(MAP_DIR, 'espana.pmtiles')).then(
			() => true,
			() => false
		),
		listSavedPlaces(k),
		listSavedRoutes(k),
		routeMapsOf(k)
	]);
	return {
		planned,
		weather: tripsWeather(k, planned).catch(() => ({})),
		people,
		map,
		places,
		routes,
		routeMaps
	};
};

/** A leg's stops from the form: a kept route of theirs, or a start and an end. */
async function legStops(form: FormData, k: Awaited<ReturnType<typeof kitchenOf>>) {
	const routeId = Number(form.get('route'));
	if (Number.isInteger(routeId) && routeId > 0) {
		const route = (await listSavedRoutes(k)).find((r) => r.id === routeId);
		return route ? stopsOf(route.stops) : null;
	}
	try {
		const stops = JSON.parse(String(form.get('stops') ?? '[]'));
		if (!Array.isArray(stops) || stops.length < 2 || stops.length > MAX_STOPS) return null;
		if (!stops.every((s) => isLngLat(s?.at))) return null;
		return stops.map((s) => ({
			name:
				String(s.name ?? '')
					.trim()
					.slice(0, 200) || 'Punto',
			at: s.at
		}));
	} catch {
		return null;
	}
}

export const actions: Actions = {
	/** A new trip, or its name, who goes and «Solo para mí». */
	saveTrip: async ({ request, locals }) => {
		const form = await request.formData();
		const id = idOf(form);
		if (id === undefined) return fail(400, { trip: 'Viaje no válido' });
		const name = String(form.get('name') ?? '')
			.trim()
			.replace(/\s+/g, ' ')
			.slice(0, MAX_TRIP_NAME);
		if (!name) return fail(400, { trip: 'Falta el nombre del viaje' });
		const saved = await saveTrip(await kitchenOf(locals.user!.id), {
			id,
			name,
			private: form.get('private') === 'on',
			people: form.getAll('people').map(String)
		});
		if (saved === null) return fail(404, { trip: 'Ese viaje ya no está' });
		return { tripSaved: saved };
	},
	deleteTrip: async ({ request, locals }) => {
		const id = idOf(await request.formData());
		if (typeof id !== 'number') return fail(400, { trip: 'Viaje no válido' });
		await deleteTrip(await kitchenOf(locals.user!.id), id);
	},
	/** A leg: its day, the time it leaves, and a kept route or a start and an end. */
	addLeg: async ({ request, locals }) => {
		const k = await kitchenOf(locals.user!.id);
		const form = await request.formData();
		const tripId = Number(form.get('trip'));
		const day = form.get('day');
		const time = form.get('time');
		if (!Number.isInteger(tripId)) return fail(400, { leg: 'Viaje no válido', tripId });
		if (!isDay(day) || !isTime(time))
			return fail(400, { leg: 'Falta el día o la hora de salida', tripId });
		const stops = await legStops(form, k);
		if (!stops) return fail(400, { leg: 'Elige una ruta, o de dónde sale y adónde llega', tripId });
		try {
			if (!(await addLeg(k, tripId, { day, time, stops })))
				return fail(404, { leg: 'Ese viaje ya no está', tripId });
		} catch (err) {
			return fail(502, { leg: orsFor(k).orsMessage(err, 'calcular la ruta'), tripId });
		}
	},
	moveLeg: async ({ request, locals }) => {
		const form = await request.formData();
		const id = idOf(form);
		const day = form.get('day');
		const time = form.get('time');
		if (typeof id !== 'number' || !isDay(day) || !isTime(time))
			return fail(400, { leg: 'Falta el día o la hora de salida' });
		await moveLeg(await kitchenOf(locals.user!.id), id, day, time);
	},
	deleteLeg: async ({ request, locals }) => {
		const id = idOf(await request.formData());
		if (typeof id !== 'number') return fail(400, { leg: 'Tramo no válido' });
		await deleteLeg(await kitchenOf(locals.user!.id), id);
	},
	savePlace: async ({ request, locals }) => {
		const k = await kitchenOf(locals.user!.id);
		const form = await request.formData();
		const id = idOf(form);
		if (id === undefined) return fail(400, { place: 'Sitio no válido' });
		const named = nameOf(form, await listSavedPlaces(k), id);
		if (!named.name) return fail(400, { place: named.problem });
		const at = [Number(form.get('lon')), Number(form.get('lat'))];
		if (!isLngLat(at))
			return fail(400, { place: 'Falta dónde está: búscalo, pega sus coordenadas o toca el mapa' });
		const address =
			String(form.get('address') ?? '')
				.trim()
				.slice(0, 300) || null;
		await savePlace(k, { id, name: named.name, at, address });
	},
	deletePlace: async ({ request, locals }) => {
		const id = idOf(await request.formData());
		if (typeof id !== 'number') return fail(400, { place: 'Sitio no válido' });
		await deletePlace(await kitchenOf(locals.user!.id), id);
	},
	saveRoute: async ({ request, locals }) => {
		const k = await kitchenOf(locals.user!.id);
		const form = await request.formData();
		const id = idOf(form);
		if (id === undefined) return fail(400, { route: 'Ruta no válida' });
		const named = nameOf(form, await listSavedRoutes(k), id);
		if (!named.name) return fail(400, { route: named.problem });
		let raw: unknown;
		try {
			raw = JSON.parse(String(form.get('stops') ?? '[]'));
		} catch {
			return fail(400, { route: 'Paradas no válidas' });
		}
		if (!Array.isArray(raw) || raw.length < 2)
			return fail(400, { route: 'Una ruta necesita al menos salida y llegada' });
		if (raw.length > MAX_STOPS) return fail(400, { route: `Como mucho ${MAX_STOPS} paradas` });
		// A kept place only if it is this user's; otherwise, the point on its own.
		const mine = new Set((await listSavedPlaces(k)).map((p) => p.id));
		const stops: RouteStop[] = [];
		for (const stop of raw) {
			if (!isLngLat(stop?.at)) return fail(400, { route: 'Hay una parada sin sitio' });
			const name =
				String(stop.name ?? '')
					.trim()
					.slice(0, 200) || 'Punto';
			stops.push(
				mine.has(stop.placeId)
					? { name, at: stop.at, placeId: stop.placeId }
					: { name, at: stop.at }
			);
		}
		try {
			await saveRoute(k, { id, name: named.name, stops });
		} catch (err) {
			return fail(502, { route: orsFor(k).orsMessage(err, 'calcular la ruta') });
		}
	},
	deleteRoute: async ({ request, locals }) => {
		const id = idOf(await request.formData());
		if (typeof id !== 'number') return fail(400, { route: 'Ruta no válida' });
		await deleteRoute(await kitchenOf(locals.user!.id), id);
	},
	/** A route's map to a device (#164), or again; done by it when the app opens on it. */
	mapDownload: async ({ request, locals }) => {
		const form = await request.formData();
		const routeId = Number(form.get('route'));
		const device = form.get('device');
		if (!Number.isInteger(routeId) || !isDeviceId(device))
			return fail(400, { maps: 'Elige el dispositivo' });
		if (!(await orderDownload(await kitchenOf(locals.user!.id), routeId, device)))
			return fail(404, { maps: 'Ruta no encontrada' });
	},
	mapRemove: async ({ request, locals }) => {
		const form = await request.formData();
		const routeId = Number(form.get('route'));
		const device = form.get('device');
		if (!Number.isInteger(routeId) || !isDeviceId(device))
			return fail(400, { maps: 'Mapa no válido' });
		await orderRemove(await kitchenOf(locals.user!.id), routeId, device);
	},
	/** It no longer keeps maps: on it, they go the next time the app opens there. */
	mapForget: async ({ request, locals }) => {
		const device = (await request.formData()).get('device');
		if (!isDeviceId(device)) return fail(400, { maps: 'Dispositivo no válido' });
		await forgetMapDevice(await kitchenOf(locals.user!.id), device);
	}
};
