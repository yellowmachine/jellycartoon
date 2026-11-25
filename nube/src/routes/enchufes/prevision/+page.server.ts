import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { localDay } from 'comun/agenda.ts';
import { kitchenOf, type Kitchen } from '#lib/server/fridge.ts';
import { energyForecast } from '#lib/server/energy/forecast.ts';
import {
	addFuel,
	addSpot,
	archiveSpot,
	boughtFuel,
	editPurchase,
	editUnit,
	endedFuel,
	FuelProblem,
	fuelStates,
	removeFuel,
	removePurchase,
	removeUnit,
	saveFuel,
	saveSpot,
	startedFuel,
	undoFuel,
	type BoughtFor,
	type FuelDone,
	type FuelUndo
} from '#lib/server/energy/fuel.ts';
import {
	addSolar,
	removeSolar,
	saveSolar,
	solarInput,
	solarState
} from '#lib/server/energy/solar.ts';
import { isFuelKind } from '#lib/fuel.ts';

/**
 * Energía → Previsión (#513): the cold to come, the light it will take, butane or pellet, and what
 * the solar panels will make.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const [forecast, fuels, solar] = await Promise.all([
		energyForecast(k),
		fuelStates(k),
		solarState(k)
	]);
	return { forecast, fuels, solar, today: localDay() };
};

const idOf = (form: FormData) => Number(form.get('id'));
const isDay = (v: unknown): v is string =>
	typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
/** The form's day; today without one. */
const dayOf = (form: FormData, name = 'day') => {
	const day = form.get(name) || localDay();
	if (!isDay(day)) throw new FuelProblem('Día no válido');
	return day;
};
const positive = (v: FormDataEntryValue | null) => {
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? n : null;
};

/** Said on the card of that fuel (`fuel`): what was done and how to undo it, or why it could not be. */
async function onFuel(
	locals: App.Locals,
	request: Request,
	run: (k: Kitchen, form: FormData) => Promise<FuelDone | string | null | void>
) {
	const form = await request.formData();
	const fuelId = Number(form.get('fuel')) || 0;
	try {
		const done = await run(await kitchenOf(locals.user!.id), form);
		const said = typeof done === 'string' ? { text: done, undo: null } : (done ?? null);
		return { fuelDone: { fuel: fuelId, text: said?.text ?? null, undo: said?.undo ?? null } };
	} catch (err) {
		if (!(err instanceof FuelProblem)) throw err;
		return fail(400, { fuelProblem: { fuel: fuelId, text: err.message } });
	}
}

/** «Deshacer»'s, as it came: only what it is made of. */
function undoOf(text: FormDataEntryValue | null): FuelUndo {
	let v: Record<string, unknown> | null = null;
	try {
		v = JSON.parse(String(text));
	} catch {
		// Not ours.
	}
	const id = (x: unknown) => (Number.isSafeInteger(x) ? (x as number) : undefined);
	const fuelId = id(v?.fuelId);
	if (!v || fuelId === undefined) throw new FuelProblem('No se puede deshacer');
	const b = v.before as { id?: unknown; endedOn?: unknown } | undefined;
	const before = id(b?.id);
	return {
		fuelId,
		started: id(v.started),
		ended: id(v.ended),
		event: id(v.event),
		before:
			before === undefined
				? undefined
				: { id: before, endedOn: isDay(b!.endedOn) ? b!.endedOn : null }
	};
}

/** «¿La has puesto?»: in a spot (`spot:3`), the one already put on (`unit:7`), or not. */
function useOf(v: FormDataEntryValue | null): BoughtFor {
	const m = /^(spot|unit):(\d+)$/.exec(String(v ?? ''));
	if (!m) return null;
	return m[1] === 'spot' ? { spotId: Number(m[2]) } : { unitId: Number(m[2]) };
}

export const actions: Actions = {
	addSolar: async ({ locals }) => {
		await addSolar(await kitchenOf(locals.user!.id));
	},
	removeSolar: async ({ locals }) => {
		await removeSolar(await kitchenOf(locals.user!.id));
	},
	saveSolar: async ({ request, locals }) => {
		const input = solarInput(await request.formData(), localDay());
		if (typeof input === 'string') return fail(400, { solarProblem: input });
		await saveSolar(await kitchenOf(locals.user!.id), input);
		return { solarSaved: true };
	},
	addFuel: ({ request, locals }) =>
		onFuel(locals, request, async (k, form) => {
			const kind = form.get('kind');
			if (!isFuelKind(kind)) throw new FuelProblem('No sé qué combustible es');
			await addFuel(k, kind, {
				full: positive(form.get('full')) ?? 0,
				startedOn: form.get('startedOn') ? dayOf(form, 'startedOn') : null
			});
		}),
	removeFuel: ({ request, locals }) =>
		onFuel(locals, request, (k, form) => removeFuel(k, idOf(form))),
	saveFuel: ({ request, locals }) =>
		onFuel(locals, request, async (k, form) => {
			const full = form.get('full');
			await saveFuel(k, idOf(form), {
				startsOnBuy: form.get('startsOnBuy') === 'on',
				alertDays: Number(form.get('alertDays')) || 5,
				// Only if it was changed: another may have put one on meanwhile.
				full:
					full === null || full === '' || full === form.get('fullWas') ? null : Number(full) || 0
			});
			return 'Guardado.';
		}),
	addSpot: ({ request, locals }) =>
		onFuel(locals, request, async (k, form) => {
			await addSpot(k, idOf(form), String(form.get('name') ?? ''));
			return 'Añadido.';
		}),
	saveSpot: ({ request, locals }) =>
		onFuel(locals, request, async (k, form) => {
			await saveSpot(k, idOf(form), {
				name: String(form.get('name') ?? ''),
				heats: form.get('heats') === 'on',
				guessDays: positive(form.get('guessDays'))
			});
			return 'Guardado.';
		}),
	archiveSpot: ({ request, locals }) =>
		onFuel(locals, request, async (k, form) => {
			await archiveSpot(k, idOf(form));
			return 'Quitado. Si lo añades otra vez con el mismo nombre, vuelve con lo aprendido.';
		}),
	started: ({ request, locals }) =>
		onFuel(locals, request, (k, form) =>
			startedFuel(k, idOf(form), Number(form.get('spot')), dayOf(form))
		),
	ended: ({ request, locals }) =>
		onFuel(locals, request, (k, form) => endedFuel(k, idOf(form), dayOf(form))),
	bought: ({ request, locals }) =>
		onFuel(locals, request, async (k, form) => {
			const quantity = Number(form.get('quantity'));
			const expenseId = form.get('expense') ? Number(form.get('expense')) : null;
			if (!Number.isInteger(quantity) || quantity < 0 || (!quantity && expenseId === null))
				throw new FuelProblem('¿Cuántas?');
			const done = await boughtFuel(k, idOf(form), dayOf(form), quantity, {
				expenseId,
				use: quantity ? useOf(form.get('use')) : null
			});
			return done ?? 'Ese gasto ya estaba apuntado.';
		}),
	undoFuel: ({ request, locals }) =>
		onFuel(locals, request, async (k, form) => {
			await undoFuel(k, undoOf(form.get('undo')));
			return 'Deshecho.';
		}),
	editUnit: ({ request, locals }) =>
		onFuel(locals, request, async (k, form) => {
			await editUnit(k, idOf(form), {
				startedOn: dayOf(form, 'startedOn'),
				endedOn: form.get('endedOn') ? dayOf(form, 'endedOn') : null,
				whole: form.get('whole') === 'on'
			});
			return 'Guardado.';
		}),
	removeUnit: ({ request, locals }) =>
		onFuel(locals, request, async (k, form) => {
			await removeUnit(k, idOf(form));
			return 'Borrado.';
		}),
	editPurchase: ({ request, locals }) =>
		onFuel(locals, request, async (k, form) => {
			await editPurchase(k, idOf(form), {
				day: dayOf(form),
				quantity: Number(form.get('quantity')) || 0
			});
			return 'Guardado.';
		}),
	removePurchase: ({ request, locals }) =>
		onFuel(locals, request, async (k, form) => {
			await removePurchase(k, idOf(form));
			return 'Borrada.';
		})
};
