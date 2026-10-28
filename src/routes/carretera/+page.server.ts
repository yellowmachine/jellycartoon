import { access } from 'node:fs/promises';
import type { PageServerLoad } from './$types';
import { listPlaylists } from '#lib/server/music/playlists.ts';
import { podcastLists } from '#lib/server/podcasts.ts';
import { stationsInfo } from '#lib/server/radio.ts';
import { mapFile, musicRoot } from '#lib/server/library/paths.ts';
import { getAlbums } from '#lib/server/music/albums.ts';
import { recordsTrips } from '#lib/server/trips.ts';
import { relayConfig } from '#lib/server/app-settings.ts';
import { listSavedPlaces, listSavedRoutes } from '#lib/server/saved-places.ts';
import { isKid } from '#lib/server/kids.ts';
import { djEnabled } from '#lib/server/music/dj.ts';
import { presetsOf } from '#lib/server/music/dj-presets.ts';

/**
 * The road mode (#78): what can be put on with one touch while driving. The stations, the albums,
 * the music lists, and the podcasts followed, each with its latest episode.
 */
import { telegramOf } from '#lib/server/telegram/telegram.ts';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const [
		info,
		albums,
		playlists,
		{ podcasts, inProgress },
		map,
		recordTrips,
		relay,
		places,
		routes
	] = await Promise.all([
		stationsInfo(),
		musicRoot ? getAlbums() : [],
		listPlaylists(),
		// The family's, in the cloud (#253).
		podcastLists(userId),
		access(mapFile).then(
			() => true,
			() => false
		),
		recordsTrips(userId),
		relayConfig(),
		listSavedPlaces(userId),
		listSavedRoutes(userId)
	]);
	// Modo DJ: only to start a setup saved in Música (#117), as there: with a voice, not for a child.
	const dj = Boolean(musicRoot) && !isKid(locals.user) && (await djEnabled());
	/** Their Telegram connected (Ajustes, #243): its messages read aloud here. */
	const telegram = !isKid(locals.user) && Boolean(await telegramOf(userId));
	const djPresets = dj ? await presetsOf(userId) : [];
	return {
		info,
		/** Without their tracks: those come when one is put on (/carretera/album). */
		albums: albums.map(({ id, title, artist, hasCover }) => ({ id, title, artist, hasCover })),
		playlists: playlists.filter((p) => p.total > 0),
		podcasts: podcasts.flatMap((p) => (p.latest ? [{ ...p, latest: p.latest }] : [])),
		inProgress,
		/** There is a map (scripts/mapa.sh): shown beside, with the screen wide enough. */
		map,
		/** This user keeps their trips (Ajustes, #81). */
		recordTrips,
		/** There is a trips relay (Ajustes): «Compartir viaje». */
		shareable: Boolean(relay.url && relay.key),
		/** Kept in Viajes with their name (#151): first in the search, one touch to go. */
		places,
		routes,
		dj,
		djPresets,
		telegram
	};
};
