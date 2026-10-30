import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { isDay, isTime, localDay } from 'comun/agenda.ts';
import { parseMark, parseMedicationInput } from 'comun/medication.ts';
import { agendaPeople, personOf } from '#lib/server/agenda/agenda.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import {
	deleteMedication,
	dosesFor,
	listMedication,
	markDose,
	saveMedication
} from '#lib/server/medication.ts';

/**
 * The family's medication (#308), in the Agenda: today's doses to mark, and what each one takes.
 * Everyone's, or one person's (`?persona=3`). Only for the grown-ups: a child does not get here
 * (kids.ts).
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await kitchenOf(locals.user!.id);
	const today = localDay();
	const asked = Number(url.searchParams.get('persona'));
	const [people, me] = await Promise.all([agendaPeople(k), personOf(k, locals.user!.id)]);
	const person = people.some((p) => p.id === String(asked)) ? String(asked) : null;
	const meds = await listMedication(k, person ? Number(person) : null);
	return { today, people, me, person, meds, doses: await dosesFor(k, meds, today) };
};

const kitchen = (locals: App.Locals) => kitchenOf(locals.user!.id);

export const actions: Actions = {
	/** New or changed: `medication` as JSON, as the page has it. */
	save: async ({ request, locals }) => {
		const form = await request.formData();
		let body: unknown;
		try {
			body = JSON.parse(String(form.get('medication') ?? ''));
		} catch {
			return fail(400, { message: 'No válido' });
		}
		const input = parseMedicationInput(body);
		if (!input) return fail(400, { message: 'Falta para quién, qué o a qué hora' });
		const id = await saveMedication(await kitchen(locals), Number(form.get('id')) || null, input);
		if (!id) return fail(404, { message: 'Ya no está' });
		return { saved: id };
	},
	delete: async ({ request, locals }) => {
		await deleteMedication(await kitchen(locals), Number((await request.formData()).get('id')));
	},
	/**
	 * Doses of one time, taken; or, again, not: `mark` says which (`3,4:1`), one or a line's (one
	 * person's at that time). Also from the home page's «Tomas de hoy».
	 */
	mark: async ({ request, locals }) => {
		const form = await request.formData();
		const day = form.get('day');
		const time = form.get('time');
		const mark = parseMark(form.get('mark'));
		if (!isDay(day) || !isTime(time) || !mark) return fail(400, { message: 'Toma no válida' });
		const k = await kitchen(locals);
		let done = 0;
		for (const id of mark.ids) if (await markDose(k, id, day, time, mark.taken)) done++;
		if (!done) return fail(404, { message: 'Esa toma ya no está' });
	}
};
