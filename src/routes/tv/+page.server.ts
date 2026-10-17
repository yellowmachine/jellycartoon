import { error } from '@sveltejs/kit';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { movie } from '#lib/server/db/schema.ts';
import { mpvEnabled } from '#lib/server/cinema/mpv.ts';
import { playEpisodes, playlistQueue, seriesQueue } from '#lib/server/cinema/episode-actions.ts';
import { cinemaRoot, musicRoot } from '#lib/server/library/paths.ts';
import { allowedMovies } from '#lib/server/kids.ts';
import { albumCovers } from '#lib/server/music/albums.ts';
import { getTodayPlaylist } from '#lib/server/playlist.ts';
import { stationsInfo } from '#lib/server/radio.ts';
import { allSeries, continueWatching } from '#lib/server/watching.ts';
import { CHANNELS } from '#lib/channels.ts';
import { STATIONS } from '#lib/radio.ts';

/** Tiles in each card's mosaic: 3 × 2. */
const MOSAIC = 6;

/** The TV view (#11): what is played here goes to the living room's mpv. */
export const load: PageServerLoad = async ({ locals }) => {
	if (!mpvEnabled) error(404, 'No hay mpv configurado (MPV_SOCKET)');
	const userId = locals.user!.id;
	const [seriesList, watching, today, [films], newestFilms, info, albums] = await Promise.all([
		allSeries(),
		continueWatching(userId),
		getTodayPlaylist(userId),
		cinemaRoot
			? db
					.select({ count: sql<number>`count(*)::int` })
					.from(movie)
					.where(and(eq(movie.status, 'ready'), eq(movie.missing, false), allowedMovies()))
			: [null],
		// The newest, for the Cine card's mosaic.
		cinemaRoot
			? db
					.select({ id: movie.id })
					.from(movie)
					.where(and(eq(movie.status, 'ready'), eq(movie.missing, false), allowedMovies()))
					.orderBy(desc(movie.id))
					.limit(MOSAIC)
			: [],
		stationsInfo(),
		musicRoot ? albumCovers(MOSAIC) : null
	]);
	const ready = seriesList.filter((s) => s.ready > 0);
	const pending = today?.items.filter((i) => !i.watched) ?? [];
	return {
		counts: {
			series: ready.length,
			films: films?.count ?? null,
			albums: albums?.count ?? null,
			stations: STATIONS.length,
			channels: CHANNELS.length
		},
		/** Behind each card, what is inside: thumbnails, and the stations' logos. */
		mosaic: {
			series: ready.flatMap((s) => s.cover ?? []).slice(0, MOSAIC),
			films: newestFilms.map((f) => f.id),
			albums: albums?.covers ?? [],
			stations: STATIONS.flatMap((s) => info?.[s.uuid]?.favicon ?? []).slice(0, MOSAIC)
		},
		continueWatching: watching,
		today: pending[0] ? { next: pending[0], pending: pending.length } : null
	};
};

export const actions: Actions = {
	/** The episode and, with «siguiente automático», the ones after it. */
	episode: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const id = Number((await request.formData()).get('id'));
		return playEpisodes(userId, await seriesQueue(userId, id));
	},
	/** Today's, from the first not watched. */
	today: async ({ locals }) => {
		const userId = locals.user!.id;
		const playlist = await getTodayPlaylist(userId);
		return playEpisodes(userId, playlistQueue(playlist?.items ?? [], null));
	}
};
