import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { plugStats } from '#lib/server/plugs/stats.ts';

/** Enchufes → Consumo (#396): ?ver=dia|semana|mes|año, ?dia=YYYY-MM-DD, ?enchufe=its id. */
export const load: PageServerLoad = async ({ locals, url }) => {
	const stats = await plugStats(locals.user!.id, {
		view: url.searchParams.get('ver'),
		day: url.searchParams.get('dia'),
		plugId: url.searchParams.get('enchufe')
	});
	if (!stats) error(404, 'Ese enchufe ya no está');
	return { stats };
};
