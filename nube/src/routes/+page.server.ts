import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { hasHouse } from '#lib/server/house.ts';
import { NoFamily, withFamily } from '#lib/server/family.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { homeOf, homeWeather } from '#lib/server/home.ts';
import { continueWatching } from '#lib/server/series.ts';
import { askForAccess } from '#lib/server/waitlist.ts';
import { EMAIL } from '#lib/invitation.ts';

/**
 * Without a session, the landing page (hooks.server.ts lets `/` through); with one, what there is
 * today in the family (home.ts). The weather and «Seguir viendo» come after the page, as they ask
 * outside (Open-Meteo, the house).
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) return { home: null };
	try {
		const userId = locals.user.id;
		const k = await kitchenOf(userId);
		const admin = await withFamily(userId, async (_, m) => m.role === 'admin');
		const [home, house] = await Promise.all([homeOf(k, userId, admin), hasHouse(userId)]);
		const who = { id: userId, email: locals.user.email };
		return {
			home: { ...home, house },
			weather: homeWeather(k).catch(() => null),
			watching: house ? continueWatching(who).catch(() => []) : Promise.resolve([])
		};
	} catch (error) {
		if (error instanceof NoFamily) return { home: null };
		throw error;
	}
};

export const actions: Actions = {
	/** «Pedir acceso», from the landing page. */
	ask: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '')
			.trim()
			.slice(0, 100);
		const email = String(form.get('email') ?? '')
			.trim()
			.toLowerCase()
			.slice(0, 200);
		const message =
			String(form.get('message') ?? '')
				.trim()
				.slice(0, 2000) || null;
		// A field people do not see: only robots fill it in. They are told it went well.
		if (form.get('web')) return { asked: true };
		if (!name || !EMAIL.test(email))
			return fail(400, { name, email, message, error: 'Escribe tu nombre y un email válido' });
		await askForAccess({ name, email, message });
		return { asked: true };
	}
};
