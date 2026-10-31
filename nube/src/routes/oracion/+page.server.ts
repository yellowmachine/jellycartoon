import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { openRouterKey } from '#lib/server/family-settings.ts';
import { prayerKitchen } from '#lib/server/prayer-pages.ts';
import { generatePrayer, listLists, listPrayers } from '#lib/server/prayers.ts';

/** Oración (#339): its lists to pray, and its texts with how their voice goes. */
export const load: PageServerLoad = async ({ locals }) => {
	const k = await prayerKitchen(locals);
	const [lists, prayers] = await Promise.all([listLists(k), listPrayers(k)]);
	return { lists, prayers };
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
	}
};
