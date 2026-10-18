import { and, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { musicQueue } from '#lib/server/db/schema.ts';
import type { QueueSave } from '#lib/music.ts';

/** Each user's music queue (music_queue): one, the last one saved from any device or app. */

export async function getQueue(userId: string) {
	const [queue] = await db.select().from(musicQueue).where(eq(musicQueue.userId, userId));
	return queue ?? null;
}

/** Instead of whatever was saved; when, to clear only this one later. */
export async function saveQueue(userId: string, queue: QueueSave) {
	const row = {
		trackIds: queue.trackIds,
		currentIndex: queue.index,
		positionSec: queue.positionSec,
		shuffle: queue.shuffle,
		repeat: queue.repeat,
		single: queue.single,
		radioUuid: queue.radio,
		podcastEpisodeId: queue.podcast,
		changedBy: queue.changedBy,
		updatedAt: new Date()
	};
	await db
		.insert(musicQueue)
		.values({ userId, ...row })
		.onConflictDoUpdate({ target: musicQueue.userId, set: row });
	return row.updatedAt;
}

/**
 * The player was closed. With `savedAt`, only if nothing was saved after it: what another device
 * is playing now stays.
 */
export async function clearQueue(userId: string, savedAt?: Date) {
	await db
		.delete(musicQueue)
		.where(
			and(eq(musicQueue.userId, userId), savedAt ? eq(musicQueue.updatedAt, savedAt) : undefined)
		);
}
