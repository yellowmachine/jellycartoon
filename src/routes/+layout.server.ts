import type { LayoutServerLoad } from './$types';
import { cinemaRoot, musicRoot } from '#lib/server/library/paths.ts';
import { mpvEnabled } from '#lib/server/cinema/mpv.ts';
import { snapcastReady } from '#lib/server/music/snapcast.ts';
import { hasKids, isKid } from '#lib/server/kids.ts';
import { isAdmin } from '#lib/server/app-settings.ts';
import { versionInfo } from '#lib/server/updates.ts';
import { voiceEnabled } from '#lib/server/voice/whisper.ts';
import { getSettings } from '#lib/server/settings.ts';
import { DEFAULT_THEME } from '#lib/themes.ts';
import { openingQuote } from '#lib/server/opening-quote.ts';
import { isGuardian } from '#lib/server/kid-login.ts';
import { dailymotionEnabled } from '#lib/server/dailymotion.ts';
import { avatarOf } from '#lib/server/people.ts';

export const load: LayoutServerLoad = async ({ locals, isDataRequest }) => {
	const kid = isKid(locals.user);
	const settings = locals.user ? await getSettings(locals.user.id) : null;
	const admin = Boolean(locals.user) && !kid && (await isAdmin(locals.user!.id));
	return {
		/** Their drawing on the bar's round badge (#157); without one, their initial. */
		user: locals.user
			? { name: locals.user.name, avatar: (await avatarOf(locals.user))?.id ?? null }
			: null,
		/** The account's colours (Ajustes), painted from the server: no flash of the default. */
		theme: settings?.theme ?? DEFAULT_THEME,
		/**
		 * The title card when the app opens (Ajustes): only when the whole page loads, not when moving
		 * around inside it.
		 */
		openingQuote:
			settings?.openingQuote && !isDataRequest
				? await openingQuote(locals.user!.id, settings.subtitleLang)
				: null,
		/** A child's account (#17): only what is tagged «infantil», and nothing to manage. */
		kid,
		/** The adults' page about what children watch, once there is a child's account. */
		kidsPage: Boolean(locals.user) && !kid && (await hasKids()),
		/** Lets in a child who asks on a device of the house (#141): its requests, on any page. */
		guardian: Boolean(locals.user) && !kid && (await isGuardian(locals.user!.id)),
		/** Only with a films folder (CINEMA_DIR). */
		cinema: Boolean(cinemaRoot),
		/** Dailymotion's cartoons (#66): only with a player made in its Studio (DAILYMOTION_PLAYER_ID). */
		dailymotion: dailymotionEnabled,
		/** Only with a music folder (MUSIC_DIR). */
		music: Boolean(musicRoot),
		/** Music can also be sent to Snapcast (MUSIC_MPV_SOCKET, while its mpv is there). */
		snapcast: Boolean(musicRoot) && snapcastReady(),
		/** Only with an mpv on the host (MPV_SOCKET). */
		salon: mpvEnabled,
		/** Voice commands (#33): only with Whisper (WHISPER_URL), and not for a child's account yet. */
		voice: voiceEnabled && !kid,
		/** A newer release, for who manages the app to install it (#20). */
		newVersion: admin ? ((await versionInfo()).update?.version ?? null) : null
	};
};
