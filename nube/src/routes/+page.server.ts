import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { isKidAccount } from '#lib/server/kids.ts';
import { homeworkToDo } from '#lib/server/homework.ts';
import { hasHouse } from '#lib/server/house.ts';
import { NoFamily, withFamily } from '#lib/server/family.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { homeOf, homeWeather, unreadInbox } from '#lib/server/home.ts';
import { nextTrip } from '#lib/server/trips/planned.ts';
import { myCar } from '#lib/server/trips/cars.ts';
import { carWithStreet } from '#lib/server/trips/car-street.ts';
import { orsFor } from '#lib/server/road/ors.ts';
import { orsKey } from '#lib/server/family-settings.ts';
import { askForAccess } from '#lib/server/waitlist.ts';
import { EMAIL } from '#lib/invitation.ts';
import { news } from '#lib/server/news.ts';
import { SEEN_SHARE, sharedWalks } from '#lib/server/walks/shared.ts';
import { companionsFor } from '#lib/server/companion.ts';

/**
 * Without a session, the landing page (hooks.server.ts lets `/` through); with one, what there is
 * today in the family (home.ts). The weather, the next trip and the news come after the page, as
 * they ask outside (Open-Meteo, their Miniflux).
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) return { home: null };
	try {
		const userId = locals.user.id;
		// A child (#303): its own home, with only what it may open.
		if (await isKidAccount(userId)) {
			const k = await kitchenOf(userId);
			return {
				home: null,
				kid: true,
				house: await hasHouse(userId),
				homework: await homeworkToDo(k, userId),
				inbox: await unreadInbox(k, userId)
			};
		}
		const k = await kitchenOf(userId);
		const admin = await withFamily(userId, async (_, m) => m.role === 'admin');
		return {
			home: await homeOf(k, userId, admin),
			// «Compañía» (#469): the linked families' people who live alone, first if one does not answer.
			companions: await companionsFor(userId).catch((error) => {
				console.warn('[portada] Sin Compañía', String(error));
				return [];
			}),
			weather: homeWeather(k).catch(() => null),
			news: news.newsOf(userId).catch((error) => {
				console.warn('[portada] Sin las noticias', String(error));
				return null;
			}),
			trip: nextTrip(k).catch((error) => {
				console.warn('[portada] Sin el próximo viaje', String(error));
				return null;
			}),
			car: myCar(k)
				.then((c) =>
					carWithStreet(c, async (at) => ((await orsKey(k)) ? orsFor(k).streetNear(at) : null))
				)
				.catch((error) => {
					console.warn('[portada] Sin el coche', String(error));
					return null;
				})
		};
	} catch (error) {
		if (error instanceof NoFamily) return { home: null };
		throw error;
	}
};

export const actions: Actions = {
	/** «Pedir acceso», from the landing page. */
	ask: async ({ request, cookies }) => {
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
		// Come from a walk shared by link (#434): whose it was, also if taken back since.
		const seen = cookies.get(SEEN_SHARE.name);
		const referredBy = seen ? await sharedWalks.sharerOf(seen).catch(() => null) : null;
		await askForAccess({ name, email, message, referredBy });
		if (seen) cookies.delete(SEEN_SHARE.name, { path: '/' });
		return { asked: true };
	}
};
