import type { PageServerLoad } from './$types';
import { isKid } from '#lib/server/kids.ts';
import { stationsInfo } from '#lib/server/radio.ts';
import { hasTripsPage } from '#lib/server/trips.ts';

export const load: PageServerLoad = async ({ locals }) => ({
	info: await stationsInfo(),
	/** «Mis viajes», beside «Modo carretera», for whoever has trips (#81). */
	trips: !isKid(locals.user) && (await hasTripsPage(locals.user!.id))
});
