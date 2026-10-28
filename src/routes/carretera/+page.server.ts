import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { cloudUrl } from '#lib/server/kitchen.ts';

/**
 * The road mode lives in the cloud (#253): there, with what it was asked (a place shared from a
 * map: `destino`, `nombre`, `buscar`), or to connect it.
 */
export const load: PageServerLoad = async ({ url }) => {
	const cloud = await cloudUrl();
	if (cloud) redirect(303, `${cloud}/carretera${url.search}`, { external: [cloud] });
	redirect(303, '/ajustes?seccion=casa#nube');
};
