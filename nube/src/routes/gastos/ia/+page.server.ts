import type { PageServerLoad } from './$types';
import { keyUsage } from '#lib/server/ai-spend.ts';
import { aiCostStats } from '#lib/server/expenses/ai-costs.ts';
import { openRouterKey } from '#lib/server/family-settings.ts';
import { kitchenOf } from '#lib/server/fridge.ts';

/**
 * Gastos → IA (#193): what the family's AI costs, the cloud's and the house's, by kind of request,
 * by month and by week; and OpenRouter's own figures for the key, which count everything.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const key = await openRouterKey(k);
	const [stats, openRouter] = await Promise.all([aiCostStats(k), key ? keyUsage(key) : null]);
	return { ...stats, openRouter };
};
