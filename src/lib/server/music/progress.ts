import { and, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { track, trackProgress } from '#lib/server/db/schema.ts';
import type { ProgressSave } from 'comun/music.ts';

/**
 * Where each person left the long audios without an album (track_progress): from this app and from
 * Seilide (its API), to go on from there on any device.
 */

/** Track id → seconds, of this person. */
export async function getProgress(userId: string): Promise<Record<number, number>> {
	const rows = await db
		.select({ trackId: trackProgress.trackId, positionSec: trackProgress.positionSec })
		.from(trackProgress)
		.where(eq(trackProgress.userId, userId));
	return Object.fromEntries(rows.map((r) => [r.trackId, r.positionSec]));
}

/** Where it is now; 0, heard to its end: forgotten. False if there is no such audio. */
export async function saveProgress(userId: string, save: ProgressSave) {
	if (save.positionSec <= 0) {
		await db
			.delete(trackProgress)
			.where(and(eq(trackProgress.userId, userId), eq(trackProgress.trackId, save.trackId)));
		return true;
	}
	const [exists] = await db.select({ id: track.id }).from(track).where(eq(track.id, save.trackId));
	if (!exists) return false;
	const row = { positionSec: save.positionSec, updatedAt: new Date() };
	await db
		.insert(trackProgress)
		.values({ userId, trackId: save.trackId, ...row })
		.onConflictDoUpdate({ target: [trackProgress.userId, trackProgress.trackId], set: row });
	return true;
}
