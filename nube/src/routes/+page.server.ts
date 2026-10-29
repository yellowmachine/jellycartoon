import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { houseLink } from '#lib/server/house.ts';
import { NoFamily } from '#lib/server/family.ts';
import { askForAccess } from '#lib/server/waitlist.ts';
import { EMAIL } from '#lib/invitation.ts';

/** Without a session, the landing page (hooks.server.ts lets `/` through). */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) return { house: null };
	try {
		return { house: await houseLink(locals.user.id) };
	} catch (error) {
		if (error instanceof NoFamily) return { house: null };
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
