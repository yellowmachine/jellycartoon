import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { cloudUrl } from '#lib/server/kitchen.ts';

/** The recipe book lives in the cloud (#253), with its own numbers: its book, or to connect it. */
export const load: PageServerLoad = async () => {
	const cloud = await cloudUrl();
	if (cloud) redirect(303, `${cloud}/recetas`, { external: [cloud] });
	redirect(303, '/ajustes?seccion=casa#nube');
};
