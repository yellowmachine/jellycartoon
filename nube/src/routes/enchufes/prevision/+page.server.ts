import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { localDay } from 'comun/agenda.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { energyForecast } from '#lib/server/energy/forecast.ts';
import {
	addFuel,
	boughtFuel,
	fuelStates,
	removeFuel,
	saveFuel,
	startedFuel
} from '#lib/server/energy/fuel.ts';
import { isFuelKind } from '#lib/fuel.ts';

/** Energía → Previsión (#513): the cold to come, the light it will take, and butane or pellet. */
export const load: PageServerLoad = async ({ locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const [forecast, fuels] = await Promise.all([energyForecast(k), fuelStates(k)]);
	return { forecast, fuels };
};

const idOf = (form: FormData) => Number(form.get('id'));
const isDay = (v: unknown): v is string =>
	typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && v <= localDay();

export const actions: Actions = {
	addFuel: async ({ request, locals }) => {
		const kind = (await request.formData()).get('kind');
		if (!isFuelKind(kind)) return fail(400, { fuelProblem: 'No sé qué combustible es' });
		await addFuel(await kitchenOf(locals.user!.id), kind);
	},
	removeFuel: async ({ request, locals }) => {
		await removeFuel(await kitchenOf(locals.user!.id), idOf(await request.formData()));
	},
	saveFuel: async ({ request, locals }) => {
		const form = await request.formData();
		const guess = Number(form.get('guessDays'));
		await saveFuel(await kitchenOf(locals.user!.id), idOf(form), {
			startsOnBuy: form.get('startsOnBuy') === 'on',
			alertDays: Number(form.get('alertDays')) || 5,
			guessDays: Number.isFinite(guess) && guess > 0 ? guess : null
		});
		return { fuelSaved: idOf(form) };
	},
	started: async ({ request, locals }) => {
		const form = await request.formData();
		const day = form.get('day') || localDay();
		if (!isDay(day)) return fail(400, { fuelProblem: 'Día no válido' });
		await startedFuel(await kitchenOf(locals.user!.id), idOf(form), day);
	},
	bought: async ({ request, locals }) => {
		const form = await request.formData();
		const day = form.get('day') || localDay();
		const quantity = Number(form.get('quantity'));
		const expense = form.get('expense') ? Number(form.get('expense')) : null;
		if (!isDay(day) || !Number.isInteger(quantity) || quantity < 0)
			return fail(400, { fuelProblem: 'Compra no válida' });
		await boughtFuel(await kitchenOf(locals.user!.id), idOf(form), day, quantity, expense);
	}
};
