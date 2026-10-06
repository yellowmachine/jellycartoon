import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { episode, playlist, playlistItem, series, watchProgress } from '#lib/server/db/schema.ts';

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
 * - serialized: from the first unwatched episode onwards, wrapping around to the start.
 * - standalone: unwatched first (shuffled), then the ones watched longest ago.
 */
function seriesQueue(episodes: Candidate[]) {
	if (episodes[0].serialized) {
		const ordered = episodes.toSorted((a, b) => a.season - b.season || a.number - b.number);
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

/** Today's date in the server's time zone (TZ), as `YYYY-MM-DD`. */
export function today() {
	const now = new Date();
	return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export async function generatePlaylist(userId: string, targetMinutes: number) {
	const candidates = await db
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
		.where(and(eq(episode.status, 'ready'), eq(episode.missing, false)));

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
			title: episode.title,
			season: episode.season,
			number: episode.number,
			durationSec: episode.durationSec,
			audioTracks: episode.audioTracks,
			subtitles: episode.subtitles,
			seriesTitle: series.title,
			positionSec: watchProgress.positionSec
		})
		.from(playlistItem)
		.innerJoin(episode, eq(episode.id, playlistItem.episodeId))
		.innerJoin(series, eq(series.id, episode.seriesId))
		.leftJoin(
			watchProgress,
			and(eq(watchProgress.episodeId, episode.id), eq(watchProgress.userId, userId))
		)
		.where(eq(playlistItem.playlistId, p.id))
		.orderBy(asc(playlistItem.position));

	return { ...p, items };
}
