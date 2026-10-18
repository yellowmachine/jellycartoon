import { sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { watchTime } from '#lib/server/db/schema.ts';
import { isKidAccount } from '#lib/server/kids.ts';
import { log } from '#lib/server/log.ts';
import { today } from '#lib/server/playlist.ts';
import { WatchSteps } from '#lib/server/watch-steps.ts';

/**
 * How long children watch (#17), from the positions saved while playing: every few seconds in the
 * browser and in mpv. What the position moved forward since the last save is time watched; going
 * back, staying (paused) or jumping ahead do not count.
 */

type Target = { episodeId: number } | { movieId: number } | { channelId: string };

function keyOf(target: Target) {
	if ('episodeId' in target) return `e${target.episodeId}`;
	if ('movieId' in target) return `m${target.movieId}`;
	return `c${target.channelId}`;
}

/** The last position saved of each user, thing and source; in memory, a restart only loses one step. */
const steps = new WatchSteps();

/** Where playing goes on: `salon` for mpv, the browser's session id for the app. */
export type Source = string;

/** `positionSec`: where playing is now, before a finished one goes back to 0. */
export async function addWatchTime(
	userId: string,
	target: Target,
	positionSec: number,
	source: Source
) {
	try {
		if (!(await isKidAccount(userId))) return;
		const step = steps.step(`${userId}:${keyOf(target)}:${source}`, positionSec);
		if (!step) return;

		await db
			.insert(watchTime)
			.values({
				userId,
				day: today(),
				episodeId: 'episodeId' in target ? target.episodeId : null,
				movieId: 'movieId' in target ? target.movieId : null,
				channelId: 'channelId' in target ? target.channelId : null,
				seconds: step
			})
			.onConflictDoUpdate({
				target: [
					watchTime.userId,
					watchTime.day,
					watchTime.episodeId,
					watchTime.movieId,
					watchTime.channelId
				],
				set: { seconds: sql`${watchTime.seconds} + ${step}` }
			});
	} catch (error) {
		// Never in the way of saving where playing is.
		log.warn('infantil', 'No se pudo apuntar el tiempo visto', { userId, ...target, error });
	}
}
