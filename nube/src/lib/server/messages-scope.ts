import { and, asc, eq, gt, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import {
	familyMember,
	msgConversation,
	msgDevice,
	msgEvent,
	msgKeyPackage,
	msgMember
} from './db/schema.ts';
import type { AnyDb, familyScope } from './family-scope.ts';

/**
 * Mensajes (#551): Seilide as MLS's delivery service. It keeps the devices' public key packages, the
 * conversations and who is in each, and a queue of encrypted events, and hands each device what is
 * its own, in order. One change of a group per epoch is accepted (`postCommit`): the others are told
 * to catch up and try again. Nothing here can read a message. Apart from the app's database, to be
 * tested on PGlite as family-scope.ts; the app's are messages.ts.
 */

/** At most this many key packages per device: enough for the groups it may be added to meanwhile. */
export const MAX_KEY_PACKAGES = 50;
/** What a device reads at a time. */
const PAGE = 500;
/** An MLS message is small; an audio goes apart (its key inside one). */
export const MAX_EVENT_BYTES = 64 * 1024;

export interface DeviceIn {
	id: string;
	name: string;
	keyPackages: string[];
}

export interface ConversationView {
	id: string;
	kind: 'familia' | 'pareja';
	epoch: number;
	/** The devices that should be in its group now: their MLS identity is `<userId>/<deviceId>`. */
	devices: { deviceId: string; userId: string }[];
}

export interface EventOut {
	id: number;
	conversationId: string;
	kind: 'welcome' | 'commit' | 'app';
	epoch: number;
	senderDevice: string;
	data: string;
	at: string;
}

export type CommitResult = { ok: boolean; epoch: number; familyId: string };

const isId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{8,64}$/.test(v);
const isB64 = (v: unknown): v is string =>
	typeof v === 'string' &&
	v.length > 0 &&
	v.length <= MAX_EVENT_BYTES * 1.4 &&
	/^[A-Za-z0-9+/=]+$/.test(v);

export class MessagesProblem extends Error {}

/** The family's conversation: one per family. */
export const familyConversationId = (familyId: string) => `familia-${familyId}`;

export function messagesScope(withFamily: ReturnType<typeof familyScope>) {
	/** This person's device, not revoked: else a problem. */
	async function ownDevice(tx: AnyDb, userId: string, deviceId: string) {
		const [d] = await tx
			.select({ id: msgDevice.id })
			.from(msgDevice)
			.where(
				and(eq(msgDevice.id, deviceId), eq(msgDevice.userId, userId), isNull(msgDevice.revokedAt))
			);
		if (!d) throw new MessagesProblem('Este aparato no tiene los mensajes activados');
	}

	/** In it: else a problem. */
	async function member(tx: AnyDb, userId: string, conversationId: string) {
		const [m] = await tx
			.select({ userId: msgMember.userId })
			.from(msgMember)
			.where(and(eq(msgMember.conversationId, conversationId), eq(msgMember.userId, userId)));
		if (!m) throw new MessagesProblem('No estás en esa conversación');
	}

	async function devicesOf(tx: AnyDb, conversationId: string) {
		return tx
			.select({ deviceId: msgDevice.id, userId: msgDevice.userId })
			.from(msgDevice)
			.innerJoin(
				msgMember,
				and(eq(msgMember.userId, msgDevice.userId), eq(msgMember.conversationId, conversationId))
			)
			.where(isNull(msgDevice.revokedAt))
			.orderBy(asc(msgDevice.createdAt));
	}

	return {
		/** A device with messages on, or its name and key packages again. */
		async registerDevice(userId: string, d: DeviceIn) {
			if (!isId(d.id)) throw new MessagesProblem('Aparato no válido');
			const name = d.name.trim().slice(0, 60) || 'Aparato';
			const packages = d.keyPackages.filter(isB64).slice(0, MAX_KEY_PACKAGES);
			return withFamily(userId, async (tx, m) => {
				const [before] = await tx
					.select({ userId: msgDevice.userId, revokedAt: msgDevice.revokedAt })
					.from(msgDevice)
					.where(eq(msgDevice.id, d.id));
				if (before && (before.userId !== userId || before.revokedAt))
					throw new MessagesProblem('Ese aparato ya no puede usarse: actívalo de nuevo');
				if (before)
					await tx
						.update(msgDevice)
						.set({ name, seenAt: new Date() })
						.where(eq(msgDevice.id, d.id));
				else await tx.insert(msgDevice).values({ id: d.id, familyId: m.familyId, userId, name });
				if (packages.length)
					await tx
						.insert(msgKeyPackage)
						.values(packages.map((data) => ({ familyId: m.familyId, deviceId: d.id, data })));
				const [{ n }] = await tx
					.select({ n: sql<number>`count(*)::int` })
					.from(msgKeyPackage)
					.where(eq(msgKeyPackage.deviceId, d.id));
				return { keyPackages: n, familyId: m.familyId };
			});
		},

		/** Lost, or taken out by its person: its groups take it out at their next change. */
		async revokeDevice(userId: string, deviceId: string) {
			return withFamily(userId, async (tx) => {
				await tx
					.update(msgDevice)
					.set({ revokedAt: new Date() })
					.where(and(eq(msgDevice.id, deviceId), eq(msgDevice.userId, userId)));
				await tx.delete(msgKeyPackage).where(eq(msgKeyPackage.deviceId, deviceId));
			});
		},

		/** This person's devices, to see and take out in Ajustes. */
		async myDevices(userId: string) {
			return withFamily(userId, (tx) =>
				tx
					.select({
						id: msgDevice.id,
						name: msgDevice.name,
						createdAt: msgDevice.createdAt,
						seenAt: msgDevice.seenAt
					})
					.from(msgDevice)
					.where(and(eq(msgDevice.userId, userId), isNull(msgDevice.revokedAt)))
					.orderBy(asc(msgDevice.createdAt))
			);
		},

		/**
		 * The family's conversation, made the first time; its people, as the family is now (those who
		 * left, out; those who came, in). Who made it has to make its group (`created`).
		 */
		async familyConversation(
			userId: string,
			deviceId: string
		): Promise<ConversationView & { created: boolean }> {
			return withFamily(userId, async (tx, m) => {
				await ownDevice(tx, userId, deviceId);
				const id = familyConversationId(m.familyId);
				const made = await tx
					.insert(msgConversation)
					.values({ id, familyId: m.familyId, kind: 'familia', homeFamilyId: m.familyId })
					.onConflictDoNothing()
					.returning({ id: msgConversation.id });
				const people = (await tx.select({ userId: familyMember.userId }).from(familyMember)).map(
					(p) => p.userId
				);
				await tx
					.delete(msgMember)
					.where(and(eq(msgMember.conversationId, id), notInArray(msgMember.userId, people)));
				await tx
					.insert(msgMember)
					.values(people.map((p) => ({ conversationId: id, familyId: m.familyId, userId: p })))
					.onConflictDoNothing();
				const [conv] = await tx
					.select({ epoch: msgConversation.epoch })
					.from(msgConversation)
					.where(eq(msgConversation.id, id));
				return {
					id,
					kind: 'familia',
					epoch: conv!.epoch,
					devices: await devicesOf(tx, id),
					created: made.length > 0
				};
			});
		},

		/** Its group as it should be now, to compare with the one the device holds. */
		async conversation(
			userId: string,
			deviceId: string,
			conversationId: string
		): Promise<ConversationView> {
			return withFamily(userId, async (tx) => {
				await ownDevice(tx, userId, deviceId);
				await member(tx, userId, conversationId);
				const [conv] = await tx
					.select()
					.from(msgConversation)
					.where(eq(msgConversation.id, conversationId));
				if (!conv) throw new MessagesProblem('No hay esa conversación');
				return {
					id: conv.id,
					kind: conv.kind,
					epoch: conv.epoch,
					devices: await devicesOf(tx, conversationId)
				};
			});
		},

		/**
		 * One key package of each of those devices of the conversation, to add them to its group: used,
		 * so never twice. A device without any left is not in the answer.
		 */
		async claimKeyPackages(
			userId: string,
			deviceId: string,
			conversationId: string,
			deviceIds: string[]
		) {
			return withFamily(userId, async (tx) => {
				await ownDevice(tx, userId, deviceId);
				await member(tx, userId, conversationId);
				const allowed = new Set((await devicesOf(tx, conversationId)).map((d) => d.deviceId));
				const out: Record<string, string> = {};
				for (const id of deviceIds.filter((d) => allowed.has(d))) {
					const [kp] = await tx
						.select({ id: msgKeyPackage.id, data: msgKeyPackage.data })
						.from(msgKeyPackage)
						.where(eq(msgKeyPackage.deviceId, id))
						.orderBy(asc(msgKeyPackage.id))
						.limit(1)
						.for('update', { skipLocked: true });
					if (!kp) continue;
					await tx.delete(msgKeyPackage).where(eq(msgKeyPackage.id, kp.id));
					out[id] = kp.data;
				}
				return out;
			});
		},

		/**
		 * A change of the group (a commit, and the welcome of those it adds), only if it was made on its
		 * last epoch: else `ok: false` with the epoch it is at, to catch up and try again.
		 */
		async postCommit(
			userId: string,
			deviceId: string,
			c: {
				conversationId: string;
				epoch: number;
				commit: string;
				welcome?: string;
				recipients?: string[];
			}
		): Promise<CommitResult> {
			if (!isB64(c.commit) || (c.welcome !== undefined && !isB64(c.welcome)))
				throw new MessagesProblem('Cambio no válido');
			return withFamily(userId, async (tx, m) => {
				await ownDevice(tx, userId, deviceId);
				await member(tx, userId, c.conversationId);
				const [conv] = await tx
					.select({ epoch: msgConversation.epoch })
					.from(msgConversation)
					.where(eq(msgConversation.id, c.conversationId))
					.for('update');
				if (!conv) throw new MessagesProblem('No hay esa conversación');
				if (conv.epoch !== c.epoch) return { ok: false, epoch: conv.epoch, familyId: m.familyId };
				const next = c.epoch + 1;
				await tx
					.update(msgConversation)
					.set({ epoch: next })
					.where(eq(msgConversation.id, c.conversationId));
				await tx.insert(msgEvent).values({
					familyId: m.familyId,
					conversationId: c.conversationId,
					kind: 'commit',
					epoch: c.epoch,
					senderDevice: deviceId,
					data: c.commit
				});
				if (c.welcome && c.recipients?.length)
					await tx.insert(msgEvent).values({
						familyId: m.familyId,
						conversationId: c.conversationId,
						kind: 'welcome',
						epoch: next,
						senderDevice: deviceId,
						recipients: c.recipients.filter(isId),
						data: c.welcome
					});
				return { ok: true, epoch: next, familyId: m.familyId };
			});
		},

		/** A message, encrypted by the device: who else is in it, to tell them. */
		async postMessage(
			userId: string,
			deviceId: string,
			m: { conversationId: string; epoch: number; data: string }
		) {
			if (!isB64(m.data)) throw new MessagesProblem('Mensaje no válido');
			return withFamily(userId, async (tx, f) => {
				await ownDevice(tx, userId, deviceId);
				await member(tx, userId, m.conversationId);
				const [ev] = await tx
					.insert(msgEvent)
					.values({
						familyId: f.familyId,
						conversationId: m.conversationId,
						kind: 'app',
						epoch: m.epoch,
						senderDevice: deviceId,
						data: m.data
					})
					.returning({ id: msgEvent.id });
				const others = await tx
					.select({ userId: msgMember.userId })
					.from(msgMember)
					.where(
						and(
							eq(msgMember.conversationId, m.conversationId),
							sql`${msgMember.userId} <> ${userId}`
						)
					);
				return { id: ev!.id, familyId: f.familyId, to: others.map((o) => o.userId) };
			});
		},

		/** What this device has not read yet, in order: its conversations', and the welcomes for it. */
		async events(userId: string, deviceId: string, since: number): Promise<EventOut[]> {
			return withFamily(userId, async (tx) => {
				await ownDevice(tx, userId, deviceId);
				await tx.update(msgDevice).set({ seenAt: new Date() }).where(eq(msgDevice.id, deviceId));
				const mine = (
					await tx
						.select({ id: msgMember.conversationId })
						.from(msgMember)
						.where(eq(msgMember.userId, userId))
				).map((r) => r.id);
				if (!mine.length) return [];
				const rows = await tx
					.select()
					.from(msgEvent)
					.where(
						and(
							gt(msgEvent.id, since),
							inArray(msgEvent.conversationId, mine),
							or(sql`${msgEvent.kind} <> 'welcome'`, sql`${msgEvent.recipients} ? ${deviceId}`)
						)
					)
					.orderBy(asc(msgEvent.id))
					.limit(PAGE);
				return rows.map((r) => ({
					id: r.id,
					conversationId: r.conversationId,
					kind: r.kind,
					epoch: r.epoch,
					senderDevice: r.senderDevice,
					data: r.data,
					at: r.createdAt.toISOString()
				}));
			});
		}
	};
}

export type MessagesScope = ReturnType<typeof messagesScope>;
