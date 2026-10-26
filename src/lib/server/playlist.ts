import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { allowedSeries } from '#lib/server/kids.ts';
import { byEpisodeOrder } from '#lib/server/episode-order.ts';
import {
	episode,
	episodeTitle,
	playlist,
	playlistItem,
	series,
	seriesTag,
	watchProgress
} from '#lib/server/db/schema.ts';

export interface Candidate {
	id: number;
	seriesId: number;
	serialized: boolean;
	season: number;
	number: number;
	durationSec: number;
	completed: boolean;
	watchedAt: Date | null;
}

function shuffle<T>(items: T[]) {
	for (let i = items.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[items[i], items[j]] = [items[j], items[i]];
	}
	return items;
}

/**
 * Per series, the order episodes should be offered in:
 * - serialized: from the first unwatched episode onwards, wrapping around to the start; the extras
 *   (season 0) only if it has nothing else.
 * - standalone: unwatched first (shuffled), then the ones watched longest ago.
 */
function seriesQueue(episodes: Candidate[]) {
	if (episodes[0].serialized) {
		const normal = episodes.filter((e) => e.season !== 0);
		const ordered = (normal.length ? normal : episodes).toSorted(byEpisodeOrder);
		const start = Math.max(
			0,
			ordered.findIndex((e) => !e.completed)
		);
		return [...ordered.slice(start), ...ordered.slice(0, start)];
	}
	const unwatched = shuffle(episodes.filter((e) => !e.completed));
	const watched = episodes
		.filter((e) => e.completed)
		.sort((a, b) => (a.watchedAt?.getTime() ?? 0) - (b.watchedAt?.getTime() ?? 0));
	return [...unwatched, ...watched];
}

/**
 * Up to `count` episodes to suggest after watching one of `currentSeries`: from other series, one
 * each, the one that is their turn (as in a playlist), from those in `preferred` first (e.g. the
 * ones sharing a tag), the rest at random.
 */
export function suggestEpisodes(
	candidates: Candidate[],
	currentSeries: number,
	count: number,
	preferred: Set<number> = new Set()
) {
	const bySeries = [...Map.groupBy(candidates, (c) => c.seriesId)].filter(
		([seriesId]) => seriesId !== currentSeries
	);
	const order = [
		...shuffle(bySeries.filter(([id]) => preferred.has(id))),
		...shuffle(bySeries.filter(([id]) => !preferred.has(id)))
	];
	return order.slice(0, count).map(([, episodes]) => seriesQueue(episodes)[0]);
}

/**
 * Picks episodes until the target duration is reached, choosing a random series each time and
 * never the same series twice in a row (unless it is the only one left).
 */
export function pickEpisodes(candidates: Candidate[], targetSec: number) {
	const queues = new Map<number, Candidate[]>();
	for (const [seriesId, episodes] of Map.groupBy(candidates, (c) => c.seriesId)) {
		queues.set(seriesId, seriesQueue(episodes));
	}

	const picked: Candidate[] = [];
	let total = 0;
	let lastSeries: number | null = null;

	while (queues.size > 0 && total < targetSec * 0.9) {
		const options = [...queues.keys()];
		const preferred = options.filter((id) => id !== lastSeries);
		const seriesId = shuffle(preferred.length ? preferred : options)[0];
		const queue = queues.get(seriesId)!;
		const next = queue[0];

		// Going a bit over is fine; going well over is not, except to avoid an empty playlist.
		if (picked.length > 0 && total + next.durationSec > targetSec * 1.15) {
			queues.delete(seriesId);
			continue;
		}

		picked.push(next);
		total += next.durationSec;
		lastSeries = seriesId;
		queue.shift();
		if (queue.length === 0) queues.delete(seriesId);
	}

	return picked;
}

/** Today's date (or `now`'s) in the server's time zone (TZ), as `YYYY-MM-DD`. */
export function today(now = new Date()) {
	return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export interface TagFilter {
	/** Only series with at least one of these tags; empty: any series. */
	include: number[];
	/** Never series with any of these tags. */
	exclude: number[];
}

/** Episodes that can be played, with the user's progress, from the series the tags allow. */
export async function getCandidates(
	userId: string,
	tags: TagFilter = { include: [], exclude: [] }
): Promise<Candidate[]> {
	const withTags = (ids: number[]) =>
		db.select({ id: seriesTag.seriesId }).from(seriesTag).where(inArray(seriesTag.tagId, ids));
	return db
		.select({
			id: episode.id,
			seriesId: episode.seriesId,
			serialized: series.serialized,
			season: episode.season,
			number: episode.number,
			durationSec: sql<number>`coalesce(${episode.durationSec}, 0)`,
			completed: sql<boolean>`coalesce(${watchProgress.completed}, false)`,
			watchedAt: watchProgress.updatedAt
		})
		.from(episode)
		.innerJoin(series, eq(series.id, episode.seriesId))
		.leftJoin(
			watchProgress,
			and(eq(watchProgress.episodeId, episode.id), eq(watchProgress.userId, userId))
		)
		.where(
			and(
				eq(episode.status, 'ready'),
				eq(episode.missing, false),
				tags.include.length ? inArray(series.id, withTags(tags.include)) : undefined,
				tags.exclude.length ? notInArray(series.id, withTags(tags.exclude)) : undefined,
				allowedSeries()
			)
		);
}

export async function generatePlaylist(userId: string, targetMinutes: number) {
	const candidates = await getCandidates(userId);
	const picked = pickEpisodes(candidates, targetMinutes * 60);

	return db.transaction(async (tx) => {
		const [p] = await tx
			.insert(playlist)
			.values({ userId, day: today(), targetMinutes })
			.onConflictDoUpdate({
				target: [playlist.userId, playlist.day],
				set: { targetMinutes, createdAt: new Date() }
			})
			.returning({ id: playlist.id });

		await tx.delete(playlistItem).where(eq(playlistItem.playlistId, p.id));
		if (picked.length) {
			await tx
				.insert(playlistItem)
				.values(picked.map((e, position) => ({ playlistId: p.id, position, episodeId: e.id })));
		}
		return p.id;
	});
}

export async function getTodayPlaylist(userId: string) {
	const [p] = await db
		.select()
		.from(playlist)
		.where(and(eq(playlist.userId, userId), eq(playlist.day, today())));
	if (!p) return null;

	const items = await db
		.select({
			position: playlistItem.position,
			watched: playlistItem.watched,
			id: episode.id,
			title: episodeTitle,
			season: episode.season,
			number: episode.number,
			durationSec: episode.durationSec,
			audioTracks: episode.audioTracks,
			subtitles: episode.subtitles,
			seriesTitle: series.title,
			positionSec: watchProgress.positionSec,
			/** Watched at some point, not necessarily from this playlist. */
			completedBefore: watchProgress.completed
		})
		.from(playlistItem)
		.innerJoin(episode, eq(episode.id, playlistItem.episodeId))
		.innerJoin(series, eq(series.id, episode.seriesId))
		.leftJoin(
			watchProgress,
			and(eq(watchProgress.episodeId, episode.id), eq(watchProgress.userId, userId))
		)
		.where(and(eq(playlistItem.playlistId, p.id), allowedSeries()))
		.orderBy(asc(playlistItem.position));

	return { ...p, items };
}
