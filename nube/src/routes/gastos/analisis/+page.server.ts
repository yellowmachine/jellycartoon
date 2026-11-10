import type { PageServerLoad } from './$types';
import { addMonths, monthOf } from 'comun/expenses.ts';
import { expenseAnalysis } from '#lib/server/expenses/analysis.ts';
import { addDueRecurring } from '#lib/server/expenses/expenses.ts';
import { kitchenOf, today } from '#lib/server/fridge.ts';
import { tagMonths } from '#lib/server/expenses/own-tags.ts';

const PERIODS = [3, 6, 12] as const;

/**
 * Gastos → Análisis (#194), for the adults: the last 12 months, what is above its usual this
 * month, and in the period (`?meses=3|6|12`, 6) the categories, the shops and the own tags by
 * month (#459). `?fijos=no`, without the fixed ones: only what varies (the own tags, as they are).
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await kitchenOf(locals.user!.id);
	const asked = Number(url.searchParams.get('meses'));
	const period = PERIODS.find((p) => p === asked) ?? 6;
	const withFixed = url.searchParams.get('fijos') !== 'no';
	await addDueRecurring(k);
	const current = monthOf(today());
	/** The period's months, this one first. */
	const months = Array.from({ length: period }, (_, i) => addMonths(current, -i));
	const [analysis, tags] = await Promise.all([
		expenseAnalysis(k, current, period, withFixed),
		tagMonths(k, `${months[months.length - 1]}-01`)
	]);
	return {
		periods: PERIODS,
		period,
		withFixed,
		current,
		...analysis,
		ownTags: { months, tags }
	};
};
