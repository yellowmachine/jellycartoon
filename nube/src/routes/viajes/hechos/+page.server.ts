import { access } from 'node:fs/promises';
import path from 'node:path';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { MAP_DIR } from '$app/env/private';
import { kitchenOf } from '#lib/server/fridge.ts';
import { deleteTrips, listTrips, recordsTrips, tripStats } from '#lib/server/trips/trips.ts';
import { deletePhoto, listPhotos } from '#lib/server/trips/photos.ts';
import { listCars, setTripCar } from '#lib/server/trips/cars.ts';

/** The road mode's trips (#81): each one's own, kept if turned on in Ajustes, with their photos. */
export const load: PageServerLoad = async ({ locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const [trips, stats, recordTrips, map, photos, cars] = await Promise.all([
		listTrips(k),
		tripStats(k),
		recordsTrips(k),
		access(path.join(MAP_DIR, 'espana.pmtiles')).then(
			() => true,
			() => false
		),
		listPhotos(k),
		listCars(k).then((cars) => cars.map(({ id, name }) => ({ id, name })))
	]);
	return { trips, stats, recordTrips, map, photos, cars };
};

export const actions: Actions = {
	delete: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (!Number.isInteger(id)) return fail(400, { message: 'Viaje no válido' });
		await deleteTrips(await kitchenOf(locals.user!.id), id);
	},
	/** The car it went in (#317), or none. */
	setCar: async ({ request, locals }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const raw = form.get('car');
		const carId = raw ? Number(raw) : null;
		if (!Number.isInteger(id) || (carId !== null && !Number.isInteger(carId)))
			return fail(400, { message: 'Coche no válido' });
		await setTripCar(await kitchenOf(locals.user!.id), id, carId);
	},
	deletePhoto: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (!Number.isInteger(id)) return fail(400, { message: 'Foto no válida' });
		await deletePhoto(await kitchenOf(locals.user!.id), id);
	},
	deleteAll: async ({ locals }) => {
		await deleteTrips(await kitchenOf(locals.user!.id), null);
	}
};
