import { fail, redirect } from '@sveltejs/kit';
import { isDay } from 'comun/agenda.ts';
import type { Actions, PageServerLoad } from './$types';
import { addDueRecurring } from '#lib/server/expenses/expenses.ts';
import { kitchenOf, today } from '#lib/server/fridge.ts';
import { keepSummary } from '#lib/server/reports.ts';
import { summaryChoice, summaryOf, summaryOff } from '#lib/server/summary.ts';
import { isSummaryView, summaryEmpty } from '#lib/summary.ts';

/**
 * Preguntar → Resumen: `?ver=` the last 7 days (by default), a week or a month (`?de=`, a day of
 * it). Not for children (kids.ts).
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const ver = url.searchParams.get('ver');
	const de = url.searchParams.get('de');
	const k = await kitchenOf(locals.user!.id);
	// The fixed ones whose day has come, as on opening Dinero.
	await addDueRecurring(k);
	return summaryOf(
		k,
		locals.user!.id,
		isSummaryView(ver) ? ver : 'dias',
		isDay(de) ? de : null,
		today(),
		(await summaryChoice(k, locals.user!.id)).off
	);
};

export const actions: Actions = {
	/** «Guardar como informe» (#624): a week or a month over, with the blocks they see; as it is now. */
	guardar: async ({ locals, request }) => {
		const form = await request.formData();
		const ver = form.get('ver');
		const de = form.get('de');
		if ((ver !== 'semana' && ver !== 'mes') || !isDay(de))
			return fail(400, { message: 'Solo se guardan semanas y meses ya terminados' });
		const userId = locals.user!.id;
		const k = await kitchenOf(userId);
		await addDueRecurring(k);
		const summary = await summaryOf(k, userId, ver, de, today(), await summaryOff(k, userId));
		if (summaryEmpty({ ...summary, charges: [], next: null }))
			return fail(400, { message: 'No hay nada que guardar en esos días' });
		redirect(303, `/preguntar/informes/${await keepSummary(k, userId, summary)}`);
	}
};
