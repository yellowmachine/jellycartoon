import { isDay } from 'comun/agenda.ts';
import type { PageServerLoad } from './$types';
import { addDueRecurring } from '#lib/server/expenses/expenses.ts';
import { kitchenOf, today } from '#lib/server/fridge.ts';
import { summaryOf } from '#lib/server/summary.ts';
import { isSummaryView } from '#lib/summary.ts';

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
		today()
	);
};
