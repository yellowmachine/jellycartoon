import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { cloudUrl } from '#lib/server/kitchen.ts';

/**
 * The agenda and the alarms live in the cloud (#253): there, on the same day and view, or to
 * connect it.
 */
export const load: PageServerLoad = async ({ url }) => {
	const cloud = await cloudUrl();
	if (!cloud) redirect(303, '/ajustes?seccion=casa#nube');
	redirect(303, `${cloud}/agenda${url.search}`, { external: [cloud] });
};
