import type { LayoutServerLoad } from './$types';
import { cinemaRoot, musicRoot } from '#lib/server/library/paths.ts';
import { mpvEnabled } from '#lib/server/cinema/mpv.ts';
import { snapcastReady } from '#lib/server/music/snapcast.ts';
import { hasKids, isKid } from '#lib/server/kids.ts';

export const load: LayoutServerLoad = async ({ locals }) => {
	const kid = isKid(locals.user);
	return {
		user: locals.user ? { name: locals.user.name } : null,
		/** A child's account (#17): only what is tagged «infantil», and nothing to manage. */
		kid,
		/** The adults' page about what children watch, once there is a child's account. */
		kidsPage: Boolean(locals.user) && !kid && (await hasKids()),
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
