import type { PageServerLoad } from './$types';
import { fridgeState, kitchenOf } from '#lib/server/fridge.ts';

/** The family's fridge: its post-its and its shopping list. */
export const load: PageServerLoad = async ({ locals }) => ({
	fridge: await fridgeState(await kitchenOf(locals.user!.id))
});
