import { error, fail } from '@sveltejs/kit';
import { ORIGIN } from '$app/env/private';
import type { Actions, PageServerLoad } from './$types';
import { isServiceAdmin } from '#lib/server/invitations.ts';
import { appClients, createAppClient, deleteAppClient } from '#lib/server/app-clients.ts';
import { refusedByProvider } from '#lib/server/house-clients.ts';

/** Only the service's administrator (ADMIN_EMAIL): to anyone else, there is no such page. */
function onlyServiceAdmin(user: App.Locals['user']) {
	if (!isServiceAdmin(user?.email)) error(404, 'Not found');
}

export const load: PageServerLoad = async ({ locals, request }) => {
	onlyServiceAdmin(locals.user);
	return { clients: await appClients(request.headers), origin: ORIGIN };
};

export const actions: Actions = {
	/** An app's client (#284): its secret, shown once, to go into the app's .env. */
	create: async ({ request, locals }) => {
		onlyServiceAdmin(locals.user);
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { problem: 'Ponle un nombre' });
		let redirectUri: URL;
		try {
			redirectUri = new URL(String(form.get('redirect') ?? '').trim());
		} catch {
			return fail(400, { problem: 'Escribe la dirección de vuelta completa, con https://' });
		}
		try {
			const made = await createAppClient(request.headers, {
				name,
				redirectUri: redirectUri.href,
				family: form.get('family') === 'on'
			});
			return { made: { ...made, name } };
		} catch (e) {
			// Its address, refused by the provider: https, unless on this same machine.
			if (refusedByProvider(e))
				return fail(400, { problem: 'La dirección de vuelta, con https://' });
			throw e;
		}
	},
	remove: async ({ request, locals }) => {
		onlyServiceAdmin(locals.user);
		await deleteAppClient(request.headers, String((await request.formData()).get('id') ?? ''));
		return { removed: true };
	}
};
