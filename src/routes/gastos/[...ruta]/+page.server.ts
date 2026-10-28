import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { cloudUrl } from '#lib/server/kitchen.ts';

/** Gastos lives in the cloud (#253): there, the same page (Análisis, Facturas), or to connect it. */
export const load: PageServerLoad = async ({ params, url }) => {
	const cloud = await cloudUrl();
	if (!cloud) redirect(303, '/ajustes?seccion=casa#nube');
	const path = `/gastos${params.ruta ? `/${params.ruta}` : ''}`;
	redirect(303, `${cloud}${path}${url.search}`, { external: [cloud] });
};
