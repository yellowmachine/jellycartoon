import { access } from 'node:fs/promises';
import { inArray, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { podcastEpisode } from '#lib/server/db/schema.ts';
import { listPlaylists } from '#lib/server/music/playlists.ts';
import { continueListening, userPodcasts } from '#lib/server/podcasts/podcasts.ts';
import { stationsInfo } from '#lib/server/radio.ts';
import { mapFile, musicRoot } from '#lib/server/library/paths.ts';
import { getAlbums } from '#lib/server/music/albums.ts';
import { recordsTrips } from '#lib/server/trips.ts';
import { relayConfig } from '#lib/server/app-settings.ts';
import { listSavedPlaces, listSavedRoutes } from '#lib/server/saved-places.ts';

/**
 * The road mode (#78): what can be put on with one touch while driving. The stations, the albums,
 * the music lists, and the podcasts followed, each with its latest episode.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const [info, albums, playlists, podcasts, inProgress, map, recordTrips, relay, places, routes] =
		await Promise.all([
			stationsInfo(),
			musicRoot ? getAlbums() : [],
			listPlaylists(),
			userPodcasts(userId),
			continueListening(userId),
			access(mapFile).then(
				() => true,
				() => false
			),
			recordsTrips(userId),
			relayConfig(),
			listSavedPlaces(userId),
			listSavedRoutes(userId)
		]);
	const latest = podcasts.length
		? await db
				.selectDistinctOn([podcastEpisode.podcastId], {
					podcastId: podcastEpisode.podcastId,
					id: podcastEpisode.id,
					title: podcastEpisode.title
				})
				.from(podcastEpisode)
				.where(
					inArray(
						podcastEpisode.podcastId,
						podcasts.map((p) => p.id)
					)
				)
				.orderBy(podcastEpisode.podcastId, sql`${podcastEpisode.publishedAt} desc nulls last`)
		: [];
	return {
		info,
		/** Without their tracks: those come when one is put on (/carretera/album). */
		albums: albums.map(({ id, title, artist, hasCover }) => ({ id, title, artist, hasCover })),
		playlists: playlists.filter((p) => p.total > 0),
		podcasts: podcasts.flatMap((p) => {
			const episode = latest.find((e) => e.podcastId === p.id);
			return episode ? [{ ...p, latest: episode }] : [];
		}),
		inProgress,
		/** There is a map (scripts/mapa.sh): shown beside, with the screen wide enough. */
		map,
		/** This user keeps their trips (Ajustes, #81). */
		recordTrips,
		/** There is a trips relay (Ajustes): «Compartir viaje». */
		shareable: Boolean(relay.url && relay.key),
		/** Kept in Viajes with their name (#151): first in the search, one touch to go. */
		places,
		routes
	};
};
