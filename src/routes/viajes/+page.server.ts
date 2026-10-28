import { access } from 'node:fs/promises';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { mapFile } from '#lib/server/library/paths.ts';
import { deleteTrips, listTrips, recordsTrips, tripStats } from '#lib/server/trips.ts';
import { deletePhoto, listPhotos } from '#lib/server/trip-photos.ts';
import {
	deletePlace,
	deleteRoute,
	listSavedPlaces,
	listSavedRoutes,
	savePlace,
	saveRoute
} from '#lib/server/saved-places.ts';
import { orsMessage } from '#lib/server/road/ors.ts';
import {
	forgetMapDevice,
	orderDownload,
	orderRemove,
	routeMapsOf
} from '#lib/server/route-maps.ts';
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
 * The road mode's trips (#81): each one's own, kept if turned on in Ajustes. And the places and
 * routes kept with their name, for the road mode (#151).
 */
export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const [trips, stats, recordTrips, map, photos, places, routes, routeMaps] = await Promise.all([
		listTrips(userId),
		tripStats(userId),
		recordsTrips(userId),
		access(mapFile).then(
			() => true,
			() => false
		),
		listPhotos(userId),
		listSavedPlaces(userId),
		listSavedRoutes(userId),
		routeMapsOf(userId)
	]);
	return { trips, stats, recordTrips, map, photos, places, routes, routeMaps };
};

export const actions: Actions = {
	delete: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (!Number.isInteger(id)) return fail(400, { message: 'Viaje no válido' });
		await deleteTrips(locals.user!.id, id);
	},
	deletePhoto: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (!Number.isInteger(id)) return fail(400, { message: 'Foto no válida' });
		await deletePhoto(locals.user!.id, id);
	},
	deleteAll: async ({ locals }) => {
		await deleteTrips(locals.user!.id, null);
	},
	savePlace: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const id = idOf(form);
		if (id === undefined) return fail(400, { place: 'Sitio no válido' });
		const named = nameOf(form, await listSavedPlaces(userId), id);
		if (!named.name) return fail(400, { place: named.problem });
		const at = [Number(form.get('lon')), Number(form.get('lat'))];
		if (!isLngLat(at))
			return fail(400, { place: 'Falta dónde está: búscalo, pega sus coordenadas o toca el mapa' });
		const address =
			String(form.get('address') ?? '')
				.trim()
				.slice(0, 300) || null;
		await savePlace(userId, { id, name: named.name, at, address });
	},
	deletePlace: async ({ request, locals }) => {
		const id = idOf(await request.formData());
		if (typeof id !== 'number') return fail(400, { place: 'Sitio no válido' });
		await deletePlace(locals.user!.id, id);
	},
	saveRoute: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const id = idOf(form);
		if (id === undefined) return fail(400, { route: 'Ruta no válida' });
		const named = nameOf(form, await listSavedRoutes(userId), id);
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
		const mine = new Set((await listSavedPlaces(userId)).map((p) => p.id));
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
			await saveRoute(userId, { id, name: named.name, stops });
		} catch (err) {
			return fail(502, { route: orsMessage(err, 'calcular la ruta') });
		}
	},
	deleteRoute: async ({ request, locals }) => {
		const id = idOf(await request.formData());
		if (typeof id !== 'number') return fail(400, { route: 'Ruta no válida' });
		await deleteRoute(locals.user!.id, id);
	},
	/** A route's map to a device (#164), or again; done by it when the app opens on it. */
	mapDownload: async ({ request, locals }) => {
		const form = await request.formData();
		const routeId = Number(form.get('route'));
		const device = form.get('device');
		if (!Number.isInteger(routeId) || !isDeviceId(device))
			return fail(400, { maps: 'Elige el dispositivo' });
		if (!(await orderDownload(locals.user!.id, routeId, device)))
			return fail(404, { maps: 'Ruta no encontrada' });
	},
	mapRemove: async ({ request, locals }) => {
		const form = await request.formData();
		const routeId = Number(form.get('route'));
		const device = form.get('device');
		if (!Number.isInteger(routeId) || !isDeviceId(device))
			return fail(400, { maps: 'Mapa no válido' });
		await orderRemove(locals.user!.id, routeId, device);
	},
	/** It no longer keeps maps: on it, they go the next time the app opens there. */
	mapForget: async ({ request }) => {
		const device = (await request.formData()).get('device');
		if (!isDeviceId(device)) return fail(400, { maps: 'Dispositivo no válido' });
		await forgetMapDevice(device);
	}
};
