import type { LayoutServerLoad } from './$types';
import { cinemaRoot } from '#lib/server/library/paths.ts';
import { mpvEnabled } from '#lib/server/cinema/mpv.ts';

export const load: LayoutServerLoad = ({ locals }) => {
	return {
		user: locals.user ? { name: locals.user.name } : null,
		/** Only with a films folder (CINEMA_DIR). */
		cinema: Boolean(cinemaRoot),
		/** Only with an mpv on the host (MPV_SOCKET). */
		salon: mpvEnabled
	};
};
