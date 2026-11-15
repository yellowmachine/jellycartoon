import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import {
	deleteReport,
	getReport,
	refreshReport,
	renameReport,
	setExcluded
} from '#lib/server/reports.ts';

/** A report (#505): only its person's; «Actualizar», its name, expenses taken away, deleted. */
const idOf = (raw: string) => {
	const id = Number(raw);
	if (!Number.isInteger(id) || id <= 0) error(404, 'No encontrado');
	return id;
};

export const load: PageServerLoad = async ({ params, locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const report = await getReport(k, locals.user!.id, idOf(params.id));
	if (!report) error(404, 'No encontrado');
	return { report };
};

export const actions: Actions = {
	actualizar: async ({ params, locals }) => {
		const k = await kitchenOf(locals.user!.id);
		if (!(await refreshReport(k, locals.user!.id, idOf(params.id))))
			return fail(404, { message: 'Ese informe ya no está' });
	},
	quitar: async ({ params, request, locals }) => {
		const form = await request.formData();
		const expense = Number(form.get('expense'));
		if (!Number.isInteger(expense)) return fail(400, { message: 'Falta el gasto' });
		const k = await kitchenOf(locals.user!.id);
		if (!(await setExcluded(k, locals.user!.id, idOf(params.id), expense, form.get('out') === '1')))
			return fail(404, { message: 'Ese informe ya no está' });
	},
	renombrar: async ({ params, request, locals }) => {
		const form = await request.formData();
		const k = await kitchenOf(locals.user!.id);
		if (!(await renameReport(k, locals.user!.id, idOf(params.id), String(form.get('title') ?? ''))))
			return fail(400, { message: 'Escribe un nombre' });
	},
	borrar: async ({ params, locals }) => {
		const k = await kitchenOf(locals.user!.id);
		await deleteReport(k, locals.user!.id, idOf(params.id));
		redirect(303, '/preguntar/informes');
	}
};
