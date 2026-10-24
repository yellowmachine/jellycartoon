import { and, asc, desc, eq, gt, inArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { kidCompanion, kidProfile, session, user } from '#lib/server/db/schema.ts';
import { KIDS_ROLE } from '#lib/server/kids.ts';
import { watchingElsewhere } from '#lib/server/live-watching.ts';
import { log } from '#lib/server/log.ts';
import { avatar } from '#lib/avatars.ts';

/**
 * Children watching together on the TV (#160): one signed in, the others added by an adult when
 * letting it in or later. What it watches counts for each of them (time, history, «Seguir
 * viendo»), from when each joined; the strictest of their limits applies to all. Until the end of
 * the day or of that session: on a device of its own, each one watches alone.
 */

/** The end of today, in the server's time zone (TZ), as a permission for the day. */
function endOfToday() {
	const end = new Date();
	end.setHours(23, 59, 59, 999);
	return end;
}

/**
 * Those watching with `kidId`. With `sessionId`, only on that session (the browser's player); with
 * none, on any (mpv in the living room, which plays for whoever signed in on the TV).
 */
export async function companionsOf(kidId: string, sessionId?: string) {
	const rows = await db
		.select({ id: kidCompanion.companionId })
		.from(kidCompanion)
		.where(
			and(
				eq(kidCompanion.kidId, kidId),
				gt(kidCompanion.until, new Date()),
				sessionId ? eq(kidCompanion.sessionId, sessionId) : undefined
			)
		);
	return rows.map((r) => r.id);
}

/** Whoever watches what `userId` puts on: itself first, then its companions. */
export async function watchersOf(userId: string, sessionId?: string) {
	return [userId, ...(await companionsOf(userId, sessionId))];
}

/** Added, with the session it is in on the TV (from a request let in, or its latest). */
export async function addCompanions(
	kidId: string,
	companionIds: string[],
	adultId: string,
	sessionId?: string
) {
	const kids = new Set((await kidsOfHouse()).map((k) => k.id));
	const ids = companionIds.filter((id) => id !== kidId && kids.has(id));
	if (!ids.length) return 0;
	sessionId ??= (
		await db
			.select({ id: session.id })
			.from(session)
			.where(and(eq(session.userId, kidId), gt(session.expiresAt, new Date())))
			.orderBy(desc(session.createdAt))
			.limit(1)
	)[0]?.id;
	if (!sessionId) return 0;
	const until = endOfToday();
	await db
		.insert(kidCompanion)
		.values(ids.map((companionId) => ({ kidId, companionId, sessionId, addedBy: adultId, until })))
		.onConflictDoUpdate({
			target: [kidCompanion.kidId, kidCompanion.companionId],
			set: { sessionId, addedBy: adultId, addedAt: new Date(), until }
		});
	log.info('peques', 'Ven juntos', { kidId, companions: ids, by: adultId });
	return ids.length;
}

export async function removeCompanion(kidId: string, companionId: string, adultId: string) {
	await db
		.delete(kidCompanion)
		.where(and(eq(kidCompanion.kidId, kidId), eq(kidCompanion.companionId, companionId)));
	log.info('peques', 'Deja de ver con los demás', { kidId, companionId, by: adultId });
}

/** The children's accounts, with their avatars. */
async function kidsOfHouse() {
	const rows = await db
		.select({ id: user.id, name: user.name, avatar: kidProfile.avatar })
		.from(user)
		.leftJoin(kidProfile, eq(kidProfile.userId, user.id))
		.where(eq(user.role, KIDS_ROLE))
		.orderBy(asc(user.name));
	return rows.map((r) => ({ ...r, avatar: avatar(r.avatar).id }));
}

export interface Together {
	kidId: string;
	/** Watching with it now. */
	with: { id: string; name: string; avatar: string }[];
	/** Who could join: not watching anything on another device right now. */
	available: { id: string; name: string; avatar: string }[];
}

/** For each of `kidIds`, who watches with it and who could join. */
export async function togetherOf(kidIds: string[]): Promise<Together[]> {
	if (!kidIds.length) return [];
	const [kids, rows] = await Promise.all([
		kidsOfHouse(),
		db
			.select({ kidId: kidCompanion.kidId, companionId: kidCompanion.companionId })
			.from(kidCompanion)
			.where(and(inArray(kidCompanion.kidId, kidIds), gt(kidCompanion.until, new Date())))
	]);
	// Watching with someone else already, or on a device of their own: not free.
	const taken = new Set(rows.map((r) => r.companionId));
	const busy = watchingElsewhere(
		kids.map((k) => k.id),
		taken
	);
	return kidIds.map((kidId) => {
		const mine = new Set(rows.filter((r) => r.kidId === kidId).map((r) => r.companionId));
		return {
			kidId,
			with: kids.filter((k) => mine.has(k.id)),
			available: kids.filter(
				(k) => k.id !== kidId && !mine.has(k.id) && !taken.has(k.id) && !busy.has(k.id)
			)
		};
	});
}

/** For the TV: `kidId` first, then those watching with it; none, if it watches alone. */
export async function watchingOnTv(kidId: string, sessionId: string) {
	const ids = await companionsOf(kidId, sessionId);
	if (!ids.length) return [];
	const rows = await db
		.select({ id: user.id, name: user.name, avatar: kidProfile.avatar })
		.from(user)
		.leftJoin(kidProfile, eq(kidProfile.userId, user.id))
		.where(inArray(user.id, [kidId, ...ids]))
		.orderBy(asc(user.name));
	const kids = rows.map((r) => ({ ...r, avatar: avatar(r.avatar).id }));
	return [...kids.filter((k) => k.id === kidId), ...kids.filter((k) => k.id !== kidId)];
}

/**
 * For «Ahora» (/infantil): those watching now who are not watching with another (the one signed in
 * on the TV, or alone), with who watches with each and who could join.
 */
export async function togetherNow(watching: { userId: string }[]) {
	const ids = watching.map((w) => w.userId);
	const all = await togetherOf(ids);
	const companions = new Set(all.flatMap((t) => t.with.map((k) => k.id)));
	return all.filter((t) => !companions.has(t.kidId));
}
