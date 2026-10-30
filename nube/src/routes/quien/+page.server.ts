import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { deviceOf, pickableKids } from '#lib/server/kid-login.ts';

/** «¿Quién eres?» (#303): only on a device of the family, and only before anyone has entered. */
export const load: PageServerLoad = async ({ locals, cookies }) => {
	if (locals.user) redirect(303, '/');
	const device = await deviceOf(cookies);
	if (!device) redirect(303, '/login?adulto');
	return { device: device.name, kids: await pickableKids(device.familyId) };
};
