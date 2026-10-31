import { and, asc, desc, eq, gte, inArray, isNull, lt, or } from 'drizzle-orm';
import { heard } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';

/**
 * What was said to the voice these last days (#331): kept two weeks, at most a few hundred a
 * person, to see what repeats (learn.ts, `proposeRules`) and as the queue of what to learn from,
 * away from the voice (`learnPending`). Each one's only theirs.
 */

export const HEARD_DAYS = 14;
const KEEP_EACH = 200;
const MAX_TEXT = 300;

/**
 * An order, kept (`userId` null: a satellite's), with what the voice answered; with `learn`, in
 * the queue to learn from (learn.ts, `learnPending`).
 */
export async function keepHeard(
	k: Kitchen,
	userId: string | null,
	text: string,
	{ answer = null, learn = false }: { answer?: string | null; learn?: boolean } = {}
) {
	const clean = text.trim().slice(0, MAX_TEXT);
	if (!clean) return;
	await k.run(async (tx) => {
		await tx.insert(heard).values({
			familyId: k.familyId,
			userId,
			text: clean,
			answer: answer?.trim().slice(0, MAX_TEXT) || null,
			learn
		});
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

/** What is waiting to be learned from, oldest first: each person's, and the satellites'. */
export function pendingHeard(k: Kitchen, limit = 100) {
	return k.run((tx) =>
		tx
			.select({
				id: heard.id,
				userId: heard.userId,
				text: heard.text,
				answer: heard.answer,
				at: heard.createdAt
			})
			.from(heard)
			.where(and(eq(heard.familyId, k.familyId), eq(heard.learn, true), isNull(heard.learnedAt)))
			.orderBy(asc(heard.createdAt))
			.limit(limit)
	);
}

/** Learned from: out of the queue. */
export async function markLearned(k: Kitchen, ids: number[]) {
	if (!ids.length) return;
	await k.run((tx) =>
		tx
			.update(heard)
			.set({ learnedAt: new Date() })
			.where(and(eq(heard.familyId, k.familyId), inArray(heard.id, ids)))
	);
}
