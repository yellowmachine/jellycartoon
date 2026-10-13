import type { LayoutServerLoad } from './$types';
import { cinemaRoot, musicRoot } from '#lib/server/library/paths.ts';
import { mpvEnabled } from '#lib/server/cinema/mpv.ts';
import { snapcastReady } from '#lib/server/music/snapcast.ts';

export const load: LayoutServerLoad = ({ locals }) => {
	return {
		user: locals.user ? { name: locals.user.name } : null,
		/** Only with a films folder (CINEMA_DIR). */
		cinema: Boolean(cinemaRoot),
		/** Only with a music folder (MUSIC_DIR). */
		music: Boolean(musicRoot),
		/** Music can also be sent to Snapcast (MUSIC_MPV_SOCKET, while its mpv is there). */
		snapcast: Boolean(musicRoot) && snapcastReady(),
		/** Only with an mpv on the host (MPV_SOCKET). */
		salon: mpvEnabled
	};
};
