import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { cloudUrl } from '#lib/server/kitchen.ts';

/**
 * The recipe book lives in the cloud (#253): there, or to connect it. Also where «Compartir →
 * JellyCartoon» lands with a recipe (/compartido): the shared address, in `url` or inside `text`
 * (Android), goes with it.
 */
export const load: PageServerLoad = async ({ url }) => {
	const cloud = await cloudUrl();
	if (!cloud) redirect(303, '/ajustes?seccion=casa#nube');
	const shared = [url.searchParams.get('url'), url.searchParams.get('text')]
		.map((v) => v?.match(/https?:\/\/\S+/)?.[0] ?? null)
		.find(Boolean);
	redirect(303, `${cloud}/recetas${shared ? `?url=${encodeURIComponent(shared)}` : ''}`, {
		external: [cloud]
	});
};
