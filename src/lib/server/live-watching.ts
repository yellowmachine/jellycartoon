import { eq, inArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	episode,
	episodeTitle,
	movie,
	movieTitle,
	series,
	tvShortcut
} from '#lib/server/db/schema.ts';
import { CHANNELS } from 'comun/channels.ts';

/**
 * What each child is watching right now, for /infantil's «Ahora»: from the positions the players
 * send every few seconds (the browser's and mpv in the living room), in memory. Nothing for a
 * minute: they are not watching. Sent but not moving: paused (mpv keeps sending while paused).
 */

/** Without news for longer, it is no longer «now». */
const STALE_MS = 60_000;
/** Without moving for longer, it is paused. */
const STILL_MS = 20_000;

type Target =
	{ episodeId: number } | { movieId: number } | { channelId: string } | { shortcutId: number };

interface Live {
	target: Target;
	positionSec: number;
	/** Where: «el salón», a device's name (Ajustes) or «el móvil». */
	device: string;
	at: number;
	movedAt: number;
}

const live = new Map<string, Live>();
/**
 * When each child last touched anything while watching: a key or a touch in the player, the remote
 * in the living room, choosing what to watch. For the adults, as «Última interacción».
 */
const touched = new Map<string, number>();
/** Asked «¿Sigues ahí?» (#77) and not answered yet: since when. */
const asking = new Map<string, number>();
/**
 * Nobody answered «¿Sigues ahí?», and it stopped: when, and what was on. Until they watch again,
 * which is not the last position the player saves as it stops.
 */
const stopped = new Map<string, { at: number; target?: Target; positionSec?: number }>();
/** Said in «Ahora» for this long after stopping. */
const STOPPED_MS = 6 * 60 * 60_000;

const same = (a: Target, b: Target) => JSON.stringify(a) === JSON.stringify(b);

/** Every position a child's player sends. */
export function noteWatching(userId: string, target: Target, positionSec: number, device: string) {
	const now = Date.now();
	const left = stopped.get(userId);
	if (
		left?.target &&
		same(left.target, target) &&
		Math.abs((left.positionSec ?? 0) - positionSec) < 1
	)
		return;
	const before = live.get(userId);
	const moved = !before || !same(before.target, target) || before.positionSec !== positionSec;
	if (moved) stopped.delete(userId);
	// Playing on: answered. Not a new one starting, which is where the question is asked.
	if (before && same(before.target, target) && before.positionSec !== positionSec)
		asking.delete(userId);
	live.set(userId, {
		target,
		positionSec,
		device,
		at: now,
		movedAt: moved ? now : before.movedAt
	});
}

/**
 * Those of `userIds` watching something right now (#160), other than `besides` (watching together
 * already): on their own tablet, they cannot join the TV.
 */
export function watchingElsewhere(userIds: string[], besides: Set<string>) {
	const now = Date.now();
	return new Set(
		userIds.filter((id) => {
			const entry = live.get(id);
			return !besides.has(id) && entry !== undefined && now - entry.at < STALE_MS;
		})
	);
}

/** «¿Sigues ahí?» asked (`true`), or answered (`false`, which is someone touching it too). */
export function noteAsking(userId: string, on: boolean) {
	if (on) asking.set(userId, Date.now());
	else {
		asking.delete(userId);
		noteTouched(userId);
	}
}

/** Someone touched something while this user watches (or chose what to watch). */
export function noteTouched(userId: string) {
	touched.set(userId, Date.now());
}

/** Nobody answered, and it stopped: not «watching» any more, and «Ahora» says so. */
export function noteStopped(userId: string) {
	const was = live.get(userId);
	asking.delete(userId);
	live.delete(userId);
	stopped.set(userId, { at: Date.now(), target: was?.target, positionSec: was?.positionSec });
}

/** Those of `userIds` whose video stopped for nobody answering, lately: when. */
export function stoppedLately(userIds: string[]) {
	const now = Date.now();
	return userIds.flatMap((userId) => {
		const at = stopped.get(userId)?.at;
		return at && now - at < STOPPED_MS ? [{ userId, at }] : [];
	});
}

export interface WatchingNow {
	userId: string;
	kind: 'episode' | 'film' | 'channel' | 'shortcut';
	title: string;
	/** The series and its number, «Película» or «En directo». */
	detail: string;
	href: string;
	positionSec: number | null;
	/** Seconds since the player sent it: it has moved on since, unless paused. */
	ageSec: number;
	device: string;
	paused: boolean;
	/** Asked «¿Sigues ahí?» and not answered yet. */
	asking: boolean;
	/** When anyone last touched anything (ms since 1970); null, not since the app started. */
	touchedAt: number | null;
	/** What to play in the small, silent copy beside it (#75). */
	mirror: { episodeId: number } | { movieId: number } | { channelUrl: string } | null;
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
	const shortcutIds = fresh.flatMap((f) => ('shortcutId' in f.target ? [f.target.shortcutId] : []));
	const [episodes, films, shortcuts] = await Promise.all([
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
			: [],
		shortcutIds.length
			? db
					.select({ id: tvShortcut.id, name: tvShortcut.name })
					.from(tvShortcut)
					.where(inArray(tvShortcut.id, shortcutIds))
			: []
	]);
	return fresh.flatMap((f): WatchingNow[] => {
		const common = {
			userId: f.userId,
			device: f.device,
			paused: now - f.movedAt >= STILL_MS,
			asking: asking.has(f.userId),
			touchedAt: touched.get(f.userId) ?? null,
			ageSec: (now - f.at) / 1000
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
					positionSec: f.positionSec,
					mirror: { episodeId: id }
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
					positionSec: f.positionSec,
					mirror: { movieId: id }
				}
			];
		}
		if ('shortcutId' in f.target) {
			const id = f.target.shortcutId;
			const shortcut = shortcuts.find((s) => s.id === id);
			if (!shortcut) return [];
			// A site of elsewhere, in its window on the TV (#327): nothing to mirror.
			return [
				{
					...common,
					kind: 'shortcut',
					title: shortcut.name,
					detail: 'Acceso directo de la tele',
					href: '/tv',
					positionSec: null,
					mirror: null
				}
			];
		}
		const channelId = f.target.channelId;
		const channel = CHANNELS.find((c) => c.id === channelId);
		if (!channel) return [];
		return [
			{
				...common,
				kind: 'channel',
				title: channel.name,
				detail: 'Canal en directo',
				href: '/canales',
				positionSec: null,
				mirror: { channelUrl: channel.url }
			}
		];
	});
}
