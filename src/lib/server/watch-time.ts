import { eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { user, watchTime } from '#lib/server/db/schema.ts';
import { isKid } from '#lib/server/kids.ts';
import { log } from '#lib/server/log.ts';
import { today } from '#lib/server/playlist.ts';

/**
 * How long children watch (#17), from the positions saved while playing: every few seconds in the
 * browser and in mpv. What the position moved forward since the last save is time watched; going
 * back, staying (paused) or jumping ahead do not count.
 */

/** More than this between two saves is a jump, not watching: they come every 5–10 seconds. */
const MAX_STEP_SEC = 60;

type Target = { episodeId: number } | { movieId: number };

/** The last position saved of each user and thing; kept in memory, a restart only loses one step. */
const last = new Map<string, number>();
/** Whether each user is a child; roles do not change once the account is created. */
const kids = new Map<string, boolean>();

async function isKidAccount(userId: string) {
	let kid = kids.get(userId);
	if (kid === undefined) {
		const [row] = await db.select({ role: user.role }).from(user).where(eq(user.id, userId));
		kid = isKid(row);
		kids.set(userId, kid);
	}
	return kid;
}

/** `positionSec`: where playing is now, before a finished one goes back to 0. */
export async function addWatchTime(userId: string, target: Target, positionSec: number) {
	try {
		if (!(await isKidAccount(userId))) return;
		const key = `${userId}:${'episodeId' in target ? `e${target.episodeId}` : `m${target.movieId}`}`;
		const previous = last.get(key);
		last.set(key, positionSec);
		const step = previous === undefined ? 0 : positionSec - previous;
		if (step <= 0 || step > MAX_STEP_SEC) return;

		await db
			.insert(watchTime)
			.values({
				userId,
				day: today(),
				episodeId: 'episodeId' in target ? target.episodeId : null,
				movieId: 'movieId' in target ? target.movieId : null,
				seconds: step
			})
			.onConflictDoUpdate({
				target: [watchTime.userId, watchTime.day, watchTime.episodeId, watchTime.movieId],
				set: { seconds: sql`${watchTime.seconds} + ${step}` }
			});
	} catch (error) {
		// Never in the way of saving where playing is.
		log.warn('infantil', 'No se pudo apuntar el tiempo visto', { userId, ...target, error });
	}
}
