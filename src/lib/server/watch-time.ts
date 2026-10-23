import { sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { watchTime } from '#lib/server/db/schema.ts';
import { isKidAccount } from '#lib/server/kids.ts';
import { keepsHistory } from '#lib/server/settings.ts';
import { noteWatching } from '#lib/server/live-watching.ts';
import { log } from '#lib/server/log.ts';
import { today } from '#lib/server/playlist.ts';
import { WatchSteps } from '#lib/server/watch-steps.ts';
import { SLOT_MINUTES } from '#lib/kid-time.ts';

/**
 * How long children watch (#17), and adults unless they turn it off in Ajustes, from the positions
 * saved while playing: every few seconds in the browser and in mpv. What the position moved forward
 * since the last save is time watched, up to the time that went by (see `WatchSteps`); going back
 * or staying (paused) do not count.
 */

type Target =
	{ episodeId: number } | { movieId: number } | { channelId: string } | { dailymotionId: string };

function keyOf(target: Target) {
	if ('episodeId' in target) return `e${target.episodeId}`;
	if ('movieId' in target) return `m${target.movieId}`;
	if ('dailymotionId' in target) return `d${target.dailymotionId}`;
	return `c${target.channelId}`;
}

/** The last position saved of each user, thing and source; in memory, a restart only loses one step. */
const steps = new WatchSteps();

/** The day and the slot of now, in the server's time zone (TZ), from the same instant. */
function slotNow() {
	const date = new Date();
	const minute = date.getHours() * 60 + date.getMinutes();
	return {
		day: today(date),
		minute: minute - (minute % SLOT_MINUTES)
	};
}

/** Where playing goes on: `salon` for mpv, the browser's session id for the app. */
export type Source = string;

/**
 * `positionSec`: where playing is now, before a finished one goes back to 0. `device`: where, as
 * the adults see it in /infantil's «Ahora» (a child's only).
 */
export async function addWatchTime(
	userId: string,
	target: Target,
	positionSec: number,
	source: Source,
	device: string
) {
	try {
		const kid = await isKidAccount(userId);
		if (kid) noteWatching(userId, target, positionSec, device);
		if (!kid && !(await keepsHistory(userId))) return;
		const step = steps.step(`${userId}:${keyOf(target)}:${source}`, positionSec);
		if (!step) return;

		await db
			.insert(watchTime)
			.values({
				userId,
				...slotNow(),
				episodeId: 'episodeId' in target ? target.episodeId : null,
				movieId: 'movieId' in target ? target.movieId : null,
				channelId: 'channelId' in target ? target.channelId : null,
				dailymotionId: 'dailymotionId' in target ? target.dailymotionId : null,
				seconds: step
			})
			.onConflictDoUpdate({
				target: [
					watchTime.userId,
					watchTime.day,
					watchTime.minute,
					watchTime.episodeId,
					watchTime.movieId,
					watchTime.channelId,
					watchTime.dailymotionId
				],
				set: { seconds: sql`${watchTime.seconds} + ${step}` }
			});
	} catch (error) {
		// Never in the way of saving where playing is.
		log.warn('infantil', 'No se pudo apuntar el tiempo visto', { userId, ...target, error });
	}
}
