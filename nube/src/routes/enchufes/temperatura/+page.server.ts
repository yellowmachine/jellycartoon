import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { outsideOf } from '#lib/server/outside.ts';
import { deletePlug, updatePlug } from '#lib/server/plugs/plugs.ts';
import { sensorsIn } from '#lib/server/plugs/sensors.ts';
import { TEMPERATURE_RANGES } from '#lib/temperature.ts';

/**
 * Enchufes → Temperatura (#508): outside where they live (Open-Meteo) and each room's sensor, its
 * reading now and its line beside outside's. `?dias=2|7|30` (2), how far back the chart goes.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const asked = Number(url.searchParams.get('dias'));
	const days = TEMPERATURE_RANGES.find((d) => d === asked) ?? 2;
	const k = await kitchenOf(locals.user!.id);
	const since = new Date(Date.now() - days * 86_400_000);
	const [{ place, weather }, sensors] = await Promise.all([
		outsideOf(k),
		k.run((tx) => sensorsIn(tx, since, days > 2))
	]);
	const from = weather?.hours.findIndex((h) => new Date(`${h.at}:00`) >= since) ?? -1;
	return {
		days,
		place,
		outside: weather && { ...weather, hours: from < 0 ? [] : weather.hours.slice(from) },
		sensors
	};
};

export const actions: Actions = {
	/** A sensor's name: the room. */
	rename: async ({ request, locals }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { problem: 'Ponle el nombre de la habitación' });
		await updatePlug(locals.user!.id, String(form.get('id') ?? ''), name, 'otro');
	},
	remove: async ({ request, locals }) => {
		const form = await request.formData();
		await deletePlug(locals.user!.id, String(form.get('id') ?? ''));
	}
};
