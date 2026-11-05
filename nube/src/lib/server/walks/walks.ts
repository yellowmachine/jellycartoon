import { and, desc, eq } from 'drizzle-orm';
import { walk } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { who } from '#lib/server/trips/trips.ts';
import { addPoints } from '#lib/trips.ts';
import { FASTEST_WALK, type parseWalk } from '#lib/walks.ts';

/** Paseos (#410): each person's, private to them; only they see or touch them. */

/** A finished walk. Sent twice (the answer got lost), it is kept once. */
export async function saveWalk(k: Kitchen, w: NonNullable<ReturnType<typeof parseWalk>>) {
	const userId = who(k);
	const { kept, distance } = addPoints(null, w.points, FASTEST_WALK);
	await k.run((tx) =>
		tx
			.insert(walk)
			.values({
				familyId: k.familyId,
				userId,
				startedAt: w.startedAt,
				endedAt: w.endedAt,
				distance,
				points: kept.length,
				line: kept,
				diagnosis: w.diagnosis
			})
			.onConflictDoNothing({ target: [walk.userId, walk.startedAt] })
	);
}

/** The walks, the latest first, without their positions. */
export function listWalks(k: Kitchen, limit = 100) {
	const userId = who(k);
	return k.run((tx) =>
		tx
			.select({
				id: walk.id,
				startedAt: walk.startedAt,
				endedAt: walk.endedAt,
				distance: walk.distance,
				points: walk.points,
				diagnosis: walk.diagnosis
			})
			.from(walk)
			.where(eq(walk.userId, userId))
			.orderBy(desc(walk.startedAt))
			.limit(limit)
	);
}

/** One walk's positions, to draw it. */
export async function walkLine(k: Kitchen, id: number) {
	const userId = who(k);
	const [row] = await k.run((tx) =>
		tx
			.select({ line: walk.line })
			.from(walk)
			.where(and(eq(walk.id, id), eq(walk.userId, userId)))
	);
	return row?.line ?? null;
}

export async function deleteWalk(k: Kitchen, id: number) {
	const userId = who(k);
	await k.run((tx) => tx.delete(walk).where(and(eq(walk.id, id), eq(walk.userId, userId))));
}
