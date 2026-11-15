import type { PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { outsideOf } from '#lib/server/outside.ts';
import { TEMPERATURE_RANGES } from '#lib/temperature.ts';

/**
 * Enchufes → Temperatura (#508): for now, outside where they live (Open-Meteo); the rooms' sensors
 * will join it. `?dias=2|7|30` (2), how far back the chart goes.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const asked = Number(url.searchParams.get('dias'));
	const days = TEMPERATURE_RANGES.find((d) => d === asked) ?? 2;
	const { place, weather } = await outsideOf(await kitchenOf(locals.user!.id));
	const since = new Date(Date.now() - days * 86_400_000);
	const from = weather?.hours.findIndex((h) => new Date(`${h.at}:00`) >= since) ?? -1;
	return {
		days,
		place,
		outside: weather && { ...weather, hours: from < 0 ? [] : weather.hours.slice(from) }
	};
};
