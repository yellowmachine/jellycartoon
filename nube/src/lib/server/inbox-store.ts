import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { inbox } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import type { PushMessage } from '#lib/server/push.ts';

/**
 * The «Buzón» in the database (#331): what inbox.ts tells each one, kept, read and taken out. Apart
 * from the telling (phones, email), to be tried on its own. Each one's only theirs: the family's
 * row-level security keeps families apart, and these queries, its people.
 */

export type InboxKind = 'agenda' | 'alarma' | 'medicacion' | 'deberes' | 'voz' | 'recado';
export type InboxLevel = 'normal' | 'urgente';

export interface Notice extends PushMessage {
	kind: InboxKind;
	level?: InboxLevel;
	/** A message's: who left it. */
	fromUserId?: string | null;
}

/** Kept a while: a family's letterbox, not an archive. */
const KEEP_DAYS = 60;
const KEEP_EACH = 200;

/** Kept in their inboxes (inbox.ts’ `tell` does it, and then tells their phones). */
export async function keepInInbox(k: Kitchen, userIds: string[], notice: Notice) {
	await k.run(async (tx) => {
		for (const userId of userIds) {
			const row = {
				familyId: k.familyId,
				userId,
				kind: notice.kind,
				level: notice.level ?? 'normal',
				title: notice.title,
				body: notice.body,
				url: notice.url,
				tag: notice.tag || null,
				fromUserId: notice.fromUserId ?? null
			};
			// The same, still unread (a reminder said again): in its place, as on the phone.
			const [again] = notice.tag
				? await tx
						.update(inbox)
						.set({ ...row, createdAt: new Date() })
						.where(
							and(
								eq(inbox.familyId, k.familyId),
								eq(inbox.userId, userId),
								eq(inbox.tag, notice.tag),
								isNull(inbox.readAt)
							)
						)
						.returning({ id: inbox.id })
				: [];
			if (!again) await tx.insert(inbox).values(row);
			await tx
				.delete(inbox)
				.where(
					and(
						eq(inbox.familyId, k.familyId),
						eq(inbox.userId, userId),
						lt(inbox.createdAt, sql`now() - make_interval(days => ${KEEP_DAYS})`)
					)
				);
			const over = await tx
				.select({ id: inbox.id })
				.from(inbox)
				.where(and(eq(inbox.familyId, k.familyId), eq(inbox.userId, userId)))
				.orderBy(desc(inbox.createdAt))
				.offset(KEEP_EACH);
			if (over.length)
				await tx.delete(inbox).where(
					inArray(
						inbox.id,
						over.map((r) => r.id)
					)
				);
		}
	});
}

export interface InboxItem {
	id: number;
	kind: string;
	level: InboxLevel;
	title: string;
	body: string;
	url: string;
	createdAt: Date;
	readAt: Date | null;
}

/** Theirs, newest first. */
export function listInbox(k: Kitchen, userId: string): Promise<InboxItem[]> {
	return k.run((tx) =>
		tx
			.select({
				id: inbox.id,
				kind: inbox.kind,
				level: inbox.level,
				title: inbox.title,
				body: inbox.body,
				url: inbox.url,
				createdAt: inbox.createdAt,
				readAt: inbox.readAt
			})
			.from(inbox)
			.where(and(eq(inbox.familyId, k.familyId), eq(inbox.userId, userId)))
			.orderBy(desc(inbox.createdAt))
	);
}

/** «Vale»: one read; without `id`, all of theirs. */
export async function markRead(k: Kitchen, userId: string, id?: number) {
	await k.run((tx) =>
		tx
			.update(inbox)
			.set({ readAt: new Date() })
			.where(
				and(
					eq(inbox.familyId, k.familyId),
					eq(inbox.userId, userId),
					isNull(inbox.readAt),
					id === undefined ? undefined : eq(inbox.id, id)
				)
			)
	);
}

/** Out of their inbox, if theirs. */
export async function removeFromInbox(k: Kitchen, userId: string, id: number) {
	await k.run((tx) =>
		tx
			.delete(inbox)
			.where(and(eq(inbox.familyId, k.familyId), eq(inbox.userId, userId), eq(inbox.id, id)))
	);
}
