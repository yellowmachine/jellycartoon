import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { mpvEnabled } from '#lib/server/cinema/mpv.ts';

export const load: PageServerLoad = () => {
	if (!mpvEnabled) error(404, 'No hay mpv configurado (MPV_SOCKET)');
};
