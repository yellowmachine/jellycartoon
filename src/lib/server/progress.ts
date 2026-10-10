import { and, eq, inArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	playlist,
	playlistItem,
	userList,
	userListItem,
	watchProgress
} from '#lib/server/db/schema.ts';
import { today } from '#lib/server/playlist.ts';

/** A watched episode has its position reset to 0: the next visit starts over. */
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
		updatedAt: new Date()
	};
	await db
		.insert(watchProgress)
		.values(values)
		.onConflictDoUpdate({ target: [watchProgress.userId, watchProgress.episodeId], set: values });
	if (completed) await tickOff(userId, episodeId);
}

/** Back to never played: no position and not watched. Lists keep their own ticks. */
export async function clearProgress(userId: string, episodeId: number) {
	await db
		.delete(watchProgress)
		.where(and(eq(watchProgress.userId, userId), eq(watchProgress.episodeId, episodeId)));
}

async function tickOff(userId: string, episodeId: number) {
	// Ticks it off today's playlist. Attributed to the playlist owner, which is also who will
	// get the credit when a playlist is played on another device.
	await db
		.update(playlistItem)
		.set({ watched: true })
		.where(
			and(
				eq(playlistItem.episodeId, episodeId),
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
				eq(userListItem.episodeId, episodeId),
				inArray(
					userListItem.listId,
					db.select({ id: userList.id }).from(userList).where(eq(userList.userId, userId))
				)
			)
		);
}
