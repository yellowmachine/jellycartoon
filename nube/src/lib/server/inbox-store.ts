import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { inbox } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import type { PushMessage } from '#lib/server/push.ts';

/**
 * The «Buzón» in the database (#331): what inbox.ts tells each one, kept, read and taken out. Apart
 * from the telling (phones, email), to be tried on its own. Each one's only theirs: the family's
 * row-level security keeps families apart, and these queries, its people.
 */

export type InboxKind =
	| 'agenda'
	| 'alarma'
	| 'medicacion'
	| 'deberes'
	| 'voz'
	| 'recado'
	| 'regla'
	| 'propuesta'
	| 'aprendido';

/**
 * Something offered in the inbox, answered with yes or no (#331): to remember (phase 5; older ones
 * have no `type`), a rule for what repeats, or an event for the agenda (phase 7).
 */
export type Proposal =
	| { type?: 'recuerdo'; text: string; untilDay: string | null; because: string }
	| { type: 'regla'; said: string; because: string }
	| { type: 'cita'; title: string; day: string; time: string | null; because: string };

export type InboxLevel = 'normal' | 'urgente';

export interface Notice extends PushMessage {
	kind: InboxKind;
	level?: InboxLevel;
	/** A message's: who left it. */
	fromUserId?: string | null;
	/** Something to remember, with «Guardar» and «No». */
	proposal?: Proposal | null;
	/** The day's «Hoy he aprendido»: its memories, each to take out. */
	learned?: { id: number; text: string }[] | null;
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
				fromUserId: notice.fromUserId ?? null,
				proposal: notice.proposal ?? null,
				learned: notice.learned ?? null
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
	proposal: Proposal | null;
	learned: { id: number; text: string }[] | null;
	tag: string | null;
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
				readAt: inbox.readAt,
				proposal: inbox.proposal,
				learned: inbox.learned,
				tag: inbox.tag
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

/**
 * An offered memory answered (#331, phase 5): what it offered, if it is theirs and still waiting;
 * then read, with its answer in its title, and no longer offered.
 */
export async function answerProposal(k: Kitchen, userId: string, id: number, kept: boolean) {
	return k.run(async (tx) => {
		const [row] = await tx
			.select({ proposal: inbox.proposal })
			.from(inbox)
			.where(and(eq(inbox.familyId, k.familyId), eq(inbox.userId, userId), eq(inbox.id, id)));
		if (!row?.proposal) return null;
		await tx
			.update(inbox)
			.set({
				proposal: null,
				readAt: new Date(),
				title: kept
					? row.proposal.type === 'regla'
						? '✓ Regla creada'
						: row.proposal.type === 'cita'
							? '✓ Añadido a la Agenda'
							: '✓ Guardado en lo que la voz recuerda'
					: '✗ No'
			})
			.where(eq(inbox.id, id));
		return row.proposal;
	});
}

/** One of «Hoy he aprendido» taken out (its memory is forgotten by the caller): the rest stay. */
export async function dropLearned(k: Kitchen, userId: string, id: number, memoryId: number) {
	return k.run(async (tx) => {
		const [row] = await tx
			.select({ learned: inbox.learned })
			.from(inbox)
			.where(and(eq(inbox.familyId, k.familyId), eq(inbox.userId, userId), eq(inbox.id, id)));
		if (!row?.learned?.some((l) => l.id === memoryId)) return false;
		const learned = row.learned.filter((l) => l.id !== memoryId);
		await tx
			.update(inbox)
			.set({ learned, body: learned.map((l) => l.text).join(' · ') || 'Nada' })
			.where(eq(inbox.id, id));
		return true;
	});
}
