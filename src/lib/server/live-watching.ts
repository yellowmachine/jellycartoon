import { eq, inArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { episode, episodeTitle, movie, movieTitle, series } from '#lib/server/db/schema.ts';
import { CHANNELS } from '#lib/channels.ts';

/**
 * What each child is watching right now, for /infantil's «Ahora»: from the positions the players
 * send every few seconds (the browser's and mpv in the living room), in memory. Nothing for a
 * minute: they are not watching. Sent but not moving: paused (mpv keeps sending while paused).
 */

/** Without news for longer, it is no longer «now». */
const STALE_MS = 60_000;
/** Without moving for longer, it is paused. */
const STILL_MS = 20_000;

type Target = { episodeId: number } | { movieId: number } | { channelId: string };

interface Live {
	target: Target;
	positionSec: number;
	/** Where: «el salón», a device's name (Ajustes) or «el móvil». */
	device: string;
	at: number;
	movedAt: number;
}

const live = new Map<string, Live>();

const same = (a: Target, b: Target) => JSON.stringify(a) === JSON.stringify(b);

/** Every position a child's player sends. */
export function noteWatching(userId: string, target: Target, positionSec: number, device: string) {
	const now = Date.now();
	const before = live.get(userId);
	const moved = !before || !same(before.target, target) || before.positionSec !== positionSec;
	live.set(userId, {
		target,
		positionSec,
		device,
		at: now,
		movedAt: moved ? now : before.movedAt
	});
}

export interface WatchingNow {
	userId: string;
	kind: 'episode' | 'film' | 'channel';
	title: string;
	/** The series and its number, «Película» or «En directo». */
	detail: string;
	href: string;
	positionSec: number | null;
	device: string;
	paused: boolean;
}

/** What these children are watching now, with its titles; those watching nothing, left out. */
export async function watchingNow(userIds: string[]): Promise<WatchingNow[]> {
	const now = Date.now();
	const fresh = userIds.flatMap((userId) => {
		const entry = live.get(userId);
		return entry && now - entry.at < STALE_MS ? [{ userId, ...entry }] : [];
	});
	const episodeIds = fresh.flatMap((f) => ('episodeId' in f.target ? [f.target.episodeId] : []));
	const movieIds = fresh.flatMap((f) => ('movieId' in f.target ? [f.target.movieId] : []));
	const [episodes, films] = await Promise.all([
		episodeIds.length
			? db
					.select({
						id: episode.id,
						title: episodeTitle,
						seriesId: series.id,
						seriesTitle: series.title,
						season: episode.season,
						number: episode.number
					})
					.from(episode)
					.innerJoin(series, eq(series.id, episode.seriesId))
					.where(inArray(episode.id, episodeIds))
			: [],
		movieIds.length
			? db
					.select({ id: movie.id, title: movieTitle })
					.from(movie)
					.where(inArray(movie.id, movieIds))
			: []
	]);
	return fresh.flatMap((f): WatchingNow[] => {
		const common = {
			userId: f.userId,
			device: f.device,
			paused: now - f.movedAt >= STILL_MS
		};
		if ('episodeId' in f.target) {
			const id = f.target.episodeId;
			const ep = episodes.find((e) => e.id === id);
			if (!ep) return [];
			return [
				{
					...common,
					kind: 'episode',
					title: ep.title,
					detail: `${ep.seriesTitle} · T${ep.season} E${ep.number}`,
					href: `/series/${ep.seriesId}`,
					positionSec: f.positionSec
				}
			];
		}
		if ('movieId' in f.target) {
			const id = f.target.movieId;
			const film = films.find((m) => m.id === id);
			if (!film) return [];
			return [
				{
					...common,
					kind: 'film',
					title: film.title,
					detail: 'Película',
					href: `/cine/${id}`,
					positionSec: f.positionSec
				}
			];
		}
		const channelId = f.target.channelId;
		return [
			{
				...common,
				kind: 'channel',
				title: CHANNELS.find((c) => c.id === channelId)?.name ?? channelId,
				detail: 'Canal en directo',
				href: '/canales',
				positionSec: null
			}
		];
	});
}
