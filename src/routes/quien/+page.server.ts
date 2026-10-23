import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { deviceOf, pickableKids } from '#lib/server/kid-login.ts';
import { mpvEnabled } from '#lib/server/cinema/mpv.ts';

/** Where a child goes once in: the TV view, where there is one (it needs the living room's mpv). */
const home = () => (mpvEnabled ? '/tv' : '/');

/** «¿Quién eres?» (#141): only on a device of the house, and only before anyone has entered. */
export const load: PageServerLoad = async ({ locals, cookies }) => {
	if (locals.user) redirect(303, home());
	const device = await deviceOf(cookies);
	if (!device) redirect(303, '/login');
	return { device: device.name, kids: await pickableKids(), home: home() };
};
