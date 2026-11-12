import type { PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { listRecipes } from '#lib/server/recipes/import.ts';

/** The kitchen's home (#483): the family's recipe book, to pick one or to find the one on. */
export const load: PageServerLoad = async ({ locals }) => ({
	recipes: await listRecipes(await kitchenOf(locals.user!.id))
});
