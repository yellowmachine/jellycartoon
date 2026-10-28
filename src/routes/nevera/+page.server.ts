import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { fridgeState } from '#lib/server/fridge.ts';
import { isKid } from '#lib/server/kids.ts';
import { cloudUrl } from '#lib/server/kitchen.ts';

/** The fridge (#131): the house's post-its and its shopping list. The adults write on it. */
export const load: PageServerLoad = async ({ locals }) => {
	if (isKid(locals.user)) redirect(303, '/');
	// With the cloud connected (#253), the family's fridge is there.
	const cloud = await cloudUrl();
	if (cloud) redirect(303, `${cloud}/nevera`, { external: [cloud] });
	return { fridge: await fridgeState() };
};
