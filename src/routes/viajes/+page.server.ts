import { access } from 'node:fs/promises';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { mapFile } from '#lib/server/library/paths.ts';
import { deleteTrips, listTrips, recordsTrips, tripStats } from '#lib/server/trips.ts';

/** The road mode's trips (#81): each one's own, kept if turned on in Ajustes. */
export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const [trips, stats, recordTrips, map] = await Promise.all([
		listTrips(userId),
		tripStats(userId),
		recordsTrips(userId),
		access(mapFile).then(
			() => true,
			() => false
		)
	]);
	return { trips, stats, recordTrips, map };
};

export const actions: Actions = {
	delete: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (!Number.isInteger(id)) return fail(400, { message: 'Viaje no válido' });
		await deleteTrips(locals.user!.id, id);
	},
	deleteAll: async ({ locals }) => {
		await deleteTrips(locals.user!.id, null);
	}
};
