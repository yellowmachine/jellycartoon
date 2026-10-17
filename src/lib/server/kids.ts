import { error, type RequestEvent } from '@sveltejs/kit';
import { and, eq, exists, sql } from 'drizzle-orm';
import { getRequestEvent } from '$app/server';
import { db } from '#lib/server/db/index.ts';
import { episode, movie, movieTag, series, seriesTag, tag, user } from '#lib/server/db/schema.ts';

/**
 * Children's accounts (#17): created from Ajustes with the role «infantil», they only see the series
 * and films with this tag. Enforced here, on the server, not by hiding things in the page.
 */
export const KIDS_TAG = 'infantil';
export const KIDS_ROLE = 'infantil';

export const isKid = (user: { role?: string | null } | undefined | null) =>
	user?.role === KIDS_ROLE;

/** Whether any child's account exists. */
export async function hasKids() {
	const [row] = await db
		.select({ one: sql`1` })
		.from(user)
		.where(eq(user.role, KIDS_ROLE))
		.limit(1);
	return Boolean(row);
}

/** Whether each user is a child; roles do not change once the account is created. */
const kidAccounts = new Map<string, boolean>();

/** For what runs outside a request, like mpv's saves: by the user's id. */
export async function isKidAccount(userId: string) {
	let kid = kidAccounts.get(userId);
	if (kid === undefined) {
		const [row] = await db.select({ role: user.role }).from(user).where(eq(user.id, userId));
		kid = isKid(row);
		kidAccounts.set(userId, kid);
	}
	return kid;
}

/** Whether the request being answered is a child's. */
export const kidsOnly = () => isKid(getRequestEvent().locals.user);

const seriesTagged = (seriesId: number | typeof series.id | typeof episode.seriesId) =>
	exists(
		db
			.select({ one: sql`1` })
			.from(seriesTag)
			.innerJoin(tag, eq(tag.id, seriesTag.tagId))
			.where(and(eq(seriesTag.seriesId, seriesId), eq(tag.name, KIDS_TAG)))
	);

const movieTagged = (movieId: number | typeof movie.id) =>
	exists(
		db
			.select({ one: sql`1` })
			.from(movieTag)
			.innerJoin(tag, eq(tag.id, movieTag.tagId))
			.where(and(eq(movieTag.movieId, movieId), eq(tag.name, KIDS_TAG)))
	);

/** A `where` condition on `series` (or on `episode`), for a child only. */
export const allowedSeries = () => (kidsOnly() ? seriesTagged(series.id) : undefined);
export const allowedEpisodes = () => (kidsOnly() ? seriesTagged(episode.seriesId) : undefined);
export const allowedMovies = () => (kidsOnly() ? movieTagged(movie.id) : undefined);

async function seriesAllowed(id: number) {
	const [row] = await db
		.select({ one: sql`1` })
		.from(series)
		.where(and(eq(series.id, id), seriesTagged(id)));
	return Boolean(row);
}

async function episodeAllowed(id: number) {
	const [row] = await db
		.select({ one: sql`1` })
		.from(episode)
		.where(and(eq(episode.id, id), seriesTagged(episode.seriesId)));
	return Boolean(row);
}

async function movieAllowed(id: number) {
	const [row] = await db
		.select({ one: sql`1` })
		.from(movie)
		.where(and(eq(movie.id, id), movieTagged(id)));
	return Boolean(row);
}

type Check = 'series' | 'episode' | 'movie';

/**
 * Everything a child may open, with the form actions it may send there; any other page, endpoint
 * or action does not exist for it. `id` says what the route's `[id]` is, to check its tag.
 */
const KIDS_ROUTES: Record<string, { id?: Check; actions?: string[]; methods?: string[] }> = {
	'/(series)': { actions: ['dismiss'] },
	'/login': {},
	'/descanso': {},
	'/logout': { actions: ['default'] },
	'/ajustes': { actions: ['playback', 'intro'] },
	'/(series)/series/[id]': {
		id: 'series',
		actions: ['toggleList', 'salon', 'setWatched', 'markPreviousWatched']
	},
	'/watch/[id]': { id: 'episode' },
	'/(series)/today': { actions: ['salon', 'generate'] },
	'/(series)/lists': { actions: ['create', 'generate', 'activate'] },
	'/(series)/lists/[id]': {
		actions: ['salon', 'rename', 'activate', 'restart', 'remove', 'up', 'down', 'delete']
	},
	'/cine': { actions: ['play', 'setWatched'] },
	'/cine/[id]': { id: 'movie', actions: ['play', 'setWatched'] },
	'/tv': { actions: ['episode', 'today'] },
	'/tv/series': {},
	'/tv/series/[id]': { id: 'series', actions: ['episode'] },
	'/tv/cine': { actions: ['play'] },
	'/tv/cine/[id]': { id: 'movie', actions: ['play'] },
	'/tv/radio': {},
	'/tv/musica': {},
	'/tv/musica/[id]': {},
	'/tv/musica/listas/[id]': {},
	'/tv/sonando': {},
	'/radio': {},
	'/salon': {},
	'/musica': {},
	'/musica/[id]': {},
	'/musica/artista/[name]': {},
	'/musica/listas': { actions: ['create'] },
	'/musica/listas/[id]': { actions: ['rename', 'delete', 'remove', 'up', 'down'] },
	'/api/hls/[id]/[...file]': { id: 'episode' },
	'/api/thumb/[id]': { id: 'episode', methods: ['GET'] },
	'/api/movie-thumb/[id]': { id: 'movie' },
	'/api/movie-frame/[id]/[at]': { id: 'movie' },
	'/api/movie-clip/[id]/[at]': { id: 'movie' },
	'/api/health': {},
	'/api/progress': {},
	'/api/settings': {},
	'/api/salon': {},
	'/api/salon/events': {},
	'/api/radio/[uuid]': {},
	'/api/music/cover/[id]': {},
	'/api/music/track/[id]': {},
	'/api/music/playlists': {},
	'/api/music/snapcast': {},
	'/api/music/snapcast/events': {}
};

/** Where a child watches video in the browser: only at its times (see kid-time.ts). */
export const VIDEO_ROUTES = new Set([
	'/watch/[id]',
	'/api/hls/[id]/[...file]',
	'/api/movie-clip/[id]/[at]'
]);

const CHECKS: Record<Check, (id: number) => Promise<boolean>> = {
	series: seriesAllowed,
	episode: episodeAllowed,
	movie: movieAllowed
};

/** 404 when a child asks for what it may not see or do. */
export async function guardKids(event: RequestEvent) {
	if (!isKid(event.locals.user) || event.url.pathname.startsWith('/api/auth')) return;
	const route = event.route.id && KIDS_ROUTES[event.route.id];
	if (!route) error(404, 'No encontrado');

	if (route.id) {
		const id = Number(event.params.id);
		if (!Number.isInteger(id) || !(await CHECKS[route.id](id))) error(404, 'No encontrado');
	}

	if (event.request.method === 'GET' || event.request.method === 'HEAD') return;
	if (event.route.id!.startsWith('/api/')) {
		if (route.methods && !route.methods.includes(event.request.method)) error(404, 'No encontrado');
		return;
	}
	// A form action: `?/name`, or the default one.
	const name =
		[...event.url.searchParams.keys()].find((k) => k.startsWith('/'))?.slice(1) ?? 'default';
	if (!route.actions?.includes(name)) error(404, 'No encontrado');
}
