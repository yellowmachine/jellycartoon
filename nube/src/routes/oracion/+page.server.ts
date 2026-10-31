import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { openRouterKey } from '#lib/server/family-settings.ts';
import { hasHouse } from '#lib/server/house.ts';
import { isKidAccount } from '#lib/server/kids.ts';
import { prayerKitchen, prayOnHouse } from '#lib/server/prayer-pages.ts';
import { generatePrayer, listLists, listPrayers } from '#lib/server/prayers.ts';

/**
 * Oración (#339): its lists to pray, and its texts with how their voice goes. `house`: a list can
 * go to the whole house's Snapcast (a grown-up, with a house connected).
 */
export const load: PageServerLoad = async ({ locals }) => {
	const k = await prayerKitchen(locals);
	const [lists, prayers, house] = await Promise.all([
		listLists(k),
		listPrayers(k),
		isKidAccount(locals.user!.id).then((kid) => !kid && hasHouse(locals.user!.id))
	]);
	return { lists, prayers, house };
};

export const actions: Actions = {
	/** Its voice, made (or made again). */
	generate: async ({ request, locals }) => {
		const k = await prayerKitchen(locals);
		const why = await generatePrayer(
			k,
			Number((await request.formData()).get('id')),
			await openRouterKey(k)
		);
		if (why) return fail(400, { problem: why });
	},
	/** A list in the whole house (Snapcast): how many texts were left out without a voice. */
	house: async ({ request, locals }) => {
		const sent = await prayOnHouse(locals, Number((await request.formData()).get('id')));
		if ('problem' in sent) return fail(400, { problem: sent.problem });
		return { inHouse: true, missing: sent.missing };
	}
};
