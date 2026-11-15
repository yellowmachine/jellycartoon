import type { PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { energyForecast } from '#lib/server/energy/forecast.ts';

/** Energía → Previsión (#513): the cold to come and the light it will take. */
export const load: PageServerLoad = async ({ locals }) => ({
	forecast: await energyForecast(await kitchenOf(locals.user!.id))
});
