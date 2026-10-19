import { access } from 'node:fs/promises';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { mapFile } from '#lib/server/library/paths.ts';
import { deleteTrips, listTrips, recordsTrips, tripStats } from '#lib/server/trips.ts';
import { deletePhoto, listPhotos } from '#lib/server/trip-photos.ts';

/** The road mode's trips (#81): each one's own, kept if turned on in Ajustes. */
export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const [trips, stats, recordTrips, map, photos] = await Promise.all([
		listTrips(userId),
		tripStats(userId),
		recordsTrips(userId),
		access(mapFile).then(
			() => true,
			() => false
		),
		listPhotos(userId)
	]);
	return { trips, stats, recordTrips, map, photos };
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
	}
};
