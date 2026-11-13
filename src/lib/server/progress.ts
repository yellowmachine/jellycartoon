import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	episode,
	playlist,
	playlistItem,
	userList,
	userListItem,
	watchProgress
} from '#lib/server/db/schema.ts';
import { today } from '#lib/server/playlist.ts';
import { episodesBefore } from '#lib/server/episode-order.ts';

/**
 * A watched episode has its position reset to 0: the next visit starts over. Playing it brings it
 * back to «Seguir viendo» if it had been taken out. Once watched it stays so (#87): watching it again
 * keeps where it goes, not undoing it.
 */
export async function saveProgress(
	userId: string,
	episodeId: number,
	positionSec: number,
	completed: boolean
) {
	const values = {
		userId,
		episodeId,
		positionSec: completed ? 0 : positionSec,
		completed,
		dismissed: false,
		updatedAt: new Date()
	};
	await db
		.insert(watchProgress)
		.values(values)
		.onConflictDoUpdate({
			target: [watchProgress.userId, watchProgress.episodeId],
			set: { ...values, completed: sql`${watchProgress.completed} or excluded.completed` }
		});
	if (completed) await tickOff(userId, [episodeId]);
}

/**
 * Marks several episodes as watched at once, e.g. the ones already seen before importing a series.
 * Those already watched are left alone: they keep their date, which the daily playlist uses, and
 * are not ticked off today's playlist again.
 */
export async function markWatched(userId: string, episodeIds: number[]) {
	if (!episodeIds.length) return;
	const updatedAt = new Date();
	const marked = await db
		.insert(watchProgress)
		.values(
			episodeIds.map((episodeId) => ({
				userId,
				episodeId,
				positionSec: 0,
				completed: true,
				updatedAt
			}))
		)
		.onConflictDoUpdate({
			target: [watchProgress.userId, watchProgress.episodeId],
			set: { positionSec: 0, completed: true, updatedAt },
			setWhere: sql`not ${watchProgress.completed}`
		})
		.returning({ episodeId: watchProgress.episodeId });
	if (marked.length)
		await tickOff(
			userId,
			marked.map((m) => m.episodeId)
		);
}

/** An episode of this series, watched or back to never played; false if it is not of it. */
export async function setEpisodeWatched(
	userId: string,
	seriesId: number,
	episodeId: number,
	watched: boolean
) {
	if (!Number.isInteger(episodeId)) return false;
	const [ep] = await db
		.select({ id: episode.id })
		.from(episode)
		.where(and(eq(episode.id, episodeId), eq(episode.seriesId, seriesId)));
	if (!ep) return false;
	if (watched) await saveProgress(userId, ep.id, 0, true);
	else await clearProgress(userId, ep.id);
	return true;
}

/**
 * «Marcar hasta este como vistos»: the ones before it in its series (extras with extras), and it;
 * false if it is not of the series.
 */
export async function markWatchedUpTo(userId: string, seriesId: number, episodeId: number) {
	if (!Number.isInteger(episodeId)) return false;
	const [ep] = await db
		.select({ season: episode.season, number: episode.number })
		.from(episode)
		.where(and(eq(episode.id, episodeId), eq(episode.seriesId, seriesId)));
	if (!ep) return false;
	const previous = await db
		.select({ id: episode.id })
		.from(episode)
		.where(and(eq(episode.seriesId, seriesId), eq(episode.missing, false), episodesBefore(ep)));
	await markWatched(userId, [...previous.map((e) => e.id), episodeId]);
	return true;
}

/** Out of «Seguir viendo», keeping where it was left. */
export async function dismissProgress(userId: string, episodeId: number) {
	await db
		.update(watchProgress)
		.set({ dismissed: true })
		.where(and(eq(watchProgress.userId, userId), eq(watchProgress.episodeId, episodeId)));
}

/** Back to never played: no position and not watched. Lists keep their own ticks. */
export async function clearProgress(userId: string, episodeId: number | number[]) {
	const ids = Array.isArray(episodeId) ? episodeId : [episodeId];
	if (!ids.length) return;
	await db
		.delete(watchProgress)
		.where(and(eq(watchProgress.userId, userId), inArray(watchProgress.episodeId, ids)));
}

async function tickOff(userId: string, episodeIds: number[]) {
	// Ticks it off today's playlist. Attributed to the playlist owner, which is also who will
	// get the credit when a playlist is played on another device.
	await db
		.update(playlistItem)
		.set({ watched: true })
		.where(
			and(
				inArray(playlistItem.episodeId, episodeIds),
				inArray(
					playlistItem.playlistId,
					db
						.select({ id: playlist.id })
						.from(playlist)
						.where(and(eq(playlist.userId, userId), eq(playlist.day, today())))
				)
			)
		);
	// And off the user's own lists, wherever it was played from.
	await db
		.update(userListItem)
		.set({ watched: true })
		.where(
			and(
				inArray(userListItem.episodeId, episodeIds),
				inArray(
					userListItem.listId,
					db.select({ id: userList.id }).from(userList).where(eq(userList.userId, userId))
				)
			)
		);
}
