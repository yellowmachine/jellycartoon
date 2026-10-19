import { access } from 'node:fs/promises';
import { inArray, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { podcastEpisode } from '#lib/server/db/schema.ts';
import { listPlaylists } from '#lib/server/music/playlists.ts';
import { continueListening, userPodcasts } from '#lib/server/podcasts/podcasts.ts';
import { stationsInfo } from '#lib/server/radio.ts';
import { mapFile } from '#lib/server/library/paths.ts';

/**
 * The road mode (#78): what can be put on with one touch while driving. The stations, the music
 * lists, and the podcasts followed, each with its latest episode.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const [info, playlists, podcasts, inProgress, map] = await Promise.all([
		stationsInfo(),
		listPlaylists(),
		userPodcasts(userId),
		continueListening(userId),
		access(mapFile).then(
			() => true,
			() => false
		)
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
		playlists: playlists.filter((p) => p.total > 0),
		podcasts: podcasts.flatMap((p) => {
			const episode = latest.find((e) => e.podcastId === p.id);
			return episode ? [{ ...p, latest: episode }] : [];
		}),
		inProgress,
		/** There is a map (scripts/mapa.sh): shown beside, with the screen wide enough. */
		map
	};
};
