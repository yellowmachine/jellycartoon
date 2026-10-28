import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { cloudUrl } from '#lib/server/kitchen.ts';

/** The fridge lives in the cloud (#253): there, or to connect it. */
export const load: PageServerLoad = async () => {
	const cloud = await cloudUrl();
	if (cloud) redirect(303, `${cloud}/nevera`, { external: [cloud] });
	redirect(303, '/ajustes?seccion=casa#nube');
};
