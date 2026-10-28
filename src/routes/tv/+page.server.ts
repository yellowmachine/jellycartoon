import { error } from '@sveltejs/kit';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { movie } from '#lib/server/db/schema.ts';
import { mpvEnabled } from '#lib/server/cinema/mpv.ts';
import { playEpisodes, playlistQueue, seriesQueue } from '#lib/server/cinema/episode-actions.ts';
import { cinemaRoot, gamesRoot, musicRoot, steamRoot } from '#lib/server/library/paths.ts';
import { allowedMovies } from '#lib/server/kids.ts';
import { albumCovers } from '#lib/server/music/albums.ts';
import { allGames } from '#lib/server/games.ts';
import { steamGames } from '#lib/server/steam.ts';
import { userPodcasts } from '#lib/server/podcasts/podcasts.ts';
import { getTodayPlaylist } from '#lib/server/playlist.ts';
import { stationsInfo } from '#lib/server/radio.ts';
import { allSeries, continueWatching } from '#lib/server/watching.ts';
import { isKid } from '#lib/server/kids.ts';
import { channelsFor } from '#lib/channels.ts';
import { STATIONS } from 'comun/radio.ts';
import { fridgeForScreen } from '#lib/server/kitchen.ts';
import { watchingOnTv } from '#lib/server/watching-together.ts';

/** Tiles in each card's mosaic: 3 × 2. */
const MOSAIC = 6;

/** The TV view (#11): what is played here goes to the living room's mpv. */
export const load: PageServerLoad = async ({ locals }) => {
	if (!mpvEnabled) error(404, 'No hay mpv configurado (MPV_SOCKET)');
	const userId = locals.user!.id;
	const kid = isKid(locals.user);
	const [seriesList, watching, today, [films], newestFilms, info, albums, podcasts, games, steam] =
		await Promise.all([
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
			musicRoot ? albumCovers(MOSAIC) : null,
			// Not for children yet (#58).
			kid ? null : userPodcasts(userId),
			// Not for children either, while it is an experiment (#176).
			gamesRoot && !kid ? allGames() : null,
			steamRoot && !kid ? steamGames() : null
		]);
	const ready = seriesList.filter((s) => s.ready > 0);
	const pending = today?.items.filter((i) => !i.watched) ?? [];
	return {
		counts: {
			series: ready.length,
			films: films?.count ?? null,
			albums: albums?.count ?? null,
			stations: STATIONS.length,
			podcasts: podcasts?.length ?? null,
			games:
				games || steam
					? (games?.reduce((n, system) => n + system.games.length, 0) ?? 0) + (steam?.length ?? 0)
					: null,
			channels: channelsFor(kid).length
		},
		/** Behind each card, what is inside: thumbnails, and the stations' logos. */
		mosaic: {
			series: ready.flatMap((s) => s.cover ?? []).slice(0, MOSAIC),
			films: newestFilms.map((f) => f.id),
			albums: albums?.covers ?? [],
			stations: STATIONS.flatMap((s) => info?.[s.uuid]?.favicon ?? []).slice(0, MOSAIC),
			podcasts: (podcasts ?? []).flatMap((p) => p.imageUrl ?? []).slice(0, MOSAIC)
		},
		continueWatching: watching,
		/**
		 * A child who entered with permission (#141): it leaves, and the device shows «¿Quién eres?»
		 * again, for another child.
		 */
		switchKid: kid && locals.session?.kidApproved === true,
		/** Watching together (#160): who, besides the one signed in. Changed from the parents' phone. */
		together: kid && locals.session ? await watchingOnTv(userId, locals.session.id) : [],
		today: pending[0] ? { next: pending[0], pending: pending.length } : null,
		/** The house's post-its and what is left to buy (#131), to look at from the sofa. */
		fridge: await fridgeForScreen()
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
