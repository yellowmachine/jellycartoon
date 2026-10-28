import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { cloudUrl } from '#lib/server/kitchen.ts';

/** The podcasts are the family's, in the cloud (#253): there, or to connect it. */
export const load: PageServerLoad = async ({ url }) => {
	const cloud = await cloudUrl();
	if (!cloud) redirect(303, '/ajustes?seccion=casa#nube');
	redirect(303, `${cloud}${url.pathname}${url.search}`, { external: [cloud] });
};
