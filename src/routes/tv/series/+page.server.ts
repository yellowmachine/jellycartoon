import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { mpvEnabled } from '#lib/server/cinema/mpv.ts';
import { allSeries } from '#lib/server/watching.ts';

export const load: PageServerLoad = async () => {
	if (!mpvEnabled) error(404, 'No hay mpv configurado (MPV_SOCKET)');
	return { series: (await allSeries()).filter((s) => s.ready > 0) };
};
