import { and, desc, eq, gte, inArray, isNull, lt, or } from 'drizzle-orm';
import { heard } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';

/**
 * What was said to the voice these last days (#331, phase 7): kept two weeks, at most a few hundred
 * a person, only to see what repeats (learn.ts, `proposeRules`). Each one's only theirs.
 */

export const HEARD_DAYS = 14;
const KEEP_EACH = 200;
const MAX_TEXT = 300;

/** An order, kept (`userId` null: a satellite's). */
export async function keepHeard(k: Kitchen, userId: string | null, text: string) {
	const clean = text.trim().slice(0, MAX_TEXT);
	if (!clean) return;
	await k.run(async (tx) => {
		await tx.insert(heard).values({ familyId: k.familyId, userId, text: clean });
		const whose = userId ? eq(heard.userId, userId) : isNull(heard.userId);
		await tx
			.delete(heard)
			.where(
				and(
					eq(heard.familyId, k.familyId),
					lt(heard.createdAt, new Date(Date.now() - HEARD_DAYS * 24 * 3600_000))
				)
			);
		const over = await tx
			.select({ id: heard.id })
			.from(heard)
			.where(and(eq(heard.familyId, k.familyId), whose))
			.orderBy(desc(heard.createdAt))
			.offset(KEEP_EACH);
		if (over.length)
			await tx.delete(heard).where(
				inArray(
					heard.id,
					over.map((r) => r.id)
				)
			);
	});
}

/** What `userId` said these last days, and what was said on the satellites; oldest first. */
export function heardOf(k: Kitchen, userId: string) {
	return k.run((tx) =>
		tx
			.select({ text: heard.text, at: heard.createdAt })
			.from(heard)
			.where(
				and(
					eq(heard.familyId, k.familyId),
					or(eq(heard.userId, userId), isNull(heard.userId)),
					gte(heard.createdAt, new Date(Date.now() - HEARD_DAYS * 24 * 3600_000))
				)
			)
			.orderBy(heard.createdAt)
	);
}
