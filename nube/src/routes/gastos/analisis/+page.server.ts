import type { PageServerLoad } from './$types';
import { monthOf } from 'comun/expenses.ts';
import { expenseAnalysis } from '#lib/server/expenses/analysis.ts';
import { addDueRecurring } from '#lib/server/expenses/expenses.ts';
import { kitchenOf, today } from '#lib/server/fridge.ts';

const PERIODS = [3, 6, 12] as const;

/**
 * Gastos → Análisis (#194), for the adults: the last 12 months, what is above its usual this
 * month, and in the period (`?meses=3|6|12`, 6) the categories and the shops. `?fijos=no`, without
 * the fixed ones: only what varies.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await kitchenOf(locals.user!.id);
	const asked = Number(url.searchParams.get('meses'));
	const period = PERIODS.find((p) => p === asked) ?? 6;
	const withFixed = url.searchParams.get('fijos') !== 'no';
	await addDueRecurring(k);
	const current = monthOf(today());
	return {
		periods: PERIODS,
		period,
		withFixed,
		current,
		...(await expenseAnalysis(k, current, period, withFixed))
	};
};
