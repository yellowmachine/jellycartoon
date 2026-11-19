import { and, asc, eq, gt, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import {
	familyMember,
	msgConversation,
	msgDevice,
	msgEvent,
	msgFile,
	msgKeyPackage,
	msgMember
} from './db/schema.ts';
import type { AnyDb, familyScope } from './family-scope.ts';

/**
 * Mensajes (#551): Seilide as MLS's delivery service. It keeps the devices' public key packages, the
 * conversations and who is in each, and a queue of encrypted events per family, and hands each device
 * what is its own, in order. One change of a group per epoch is accepted (`postCommit`): the others
 * are told to catch up and try again. Nothing here can read a message.
 *
 * Conversations: the family's, and two people's: of the same family, or of two linked ones (#464),
 * kept in both families with the same id, every event in both queues in one transaction. A queue is
 * written under its family's lock, so its ids are in the order they are committed and a device never
 * reads past one still being written. Apart from the app's database, to be tested on PGlite as
 * family-scope.ts; the app's are messages.ts.
 */

/** At most this many key packages per device: enough for the groups it may be added to meanwhile. */
export const MAX_KEY_PACKAGES = 50;
/** What a device reads at a time. */
const PAGE = 500;
/** An MLS message is small; a voice note or a photo goes apart (its key inside one). */
export const MAX_EVENT_BYTES = 64 * 1024;
/** A message's file, encrypted: some 5 minutes of Opus, or a photo made small, with room. */
export const MAX_FILE_BYTES = 6 * 1024 * 1024;

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

export interface ConversationListed {
	id: string;
	kind: 'familia' | 'pareja';
	/** Two people's: the other one. */
	with: string | null;
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

export type CommitResult = { ok: boolean; epoch: number; familyIds: string[] };

/**
 * Whom this person may write to on their own (as they may call, #330): someone of their family, or an
 * adult of a linked family; that one's family, or null.
 */
export type PartnerOf = (userId: string, otherId: string) => Promise<{ familyId: string } | null>;

const isId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{8,64}$/.test(v);
const isB64 = (v: unknown): v is string =>
	typeof v === 'string' &&
	v.length > 0 &&
	v.length <= MAX_EVENT_BYTES * 1.4 &&
	/^[A-Za-z0-9+/=]+$/.test(v);

export class MessagesProblem extends Error {}

/** The family's conversation: one per family. */
export const familyConversationId = (familyId: string) => `familia-${familyId}`;
/** Two people's: the same whoever opens it first. */
export const pairConversationId = (a: string, b: string) => `pareja-${[a, b].sort().join('-')}`;

type Row = typeof msgConversation.$inferSelect;
type Device = { deviceId: string; userId: string; familyId: string };

/** The rows of another family, within the same transaction, by its policies; then one's own again. */
async function inFamily<T>(tx: AnyDb, own: string, familyId: string, fn: () => Promise<T>) {
	if (familyId === own) return fn();
	await tx.execute(sql`select set_config('app.family_id', ${familyId}, true)`);
	try {
		return await fn();
	} finally {
		await tx.execute(sql`select set_config('app.family_id', ${own}, true)`);
	}
}

/** The families' queues, locked in the same order always: their ids then come in commit order. */
async function lockQueues(tx: AnyDb, familyIds: string[]) {
	for (const f of [...familyIds].sort())
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`mensajes:${f}`}))`);
}

const familiesOf = (row: Row) => [
	row.familyId,
	...(row.linkedFamilyId ? [row.linkedFamilyId] : [])
];

export function messagesScope(withFamily: ReturnType<typeof familyScope>, partnerOf: PartnerOf) {
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

	/** Its row in this family, with this person in it: else a problem. */
	async function convOf(tx: AnyDb, userId: string, conversationId: string): Promise<Row> {
		const [m] = await tx
			.select({ userId: msgMember.userId })
			.from(msgMember)
			.where(and(eq(msgMember.conversationId, conversationId), eq(msgMember.userId, userId)));
		if (!m) throw new MessagesProblem('No estás en esa conversación');
		const [row] = await tx
			.select()
			.from(msgConversation)
			.where(eq(msgConversation.id, conversationId));
		if (!row) throw new MessagesProblem('No hay esa conversación');
		return row;
	}

	/**
	 * Two people of linked families: still linked, or a problem. Asked before the transaction that
	 * writes (and locks the queues): the link is another family's matter, read apart.
	 */
	async function stillLinked(userId: string, conversationId: string) {
		const other = await withFamily(userId, async (tx) => {
			const [row] = await tx
				.select({ linked: msgConversation.linkedFamilyId })
				.from(msgConversation)
				.where(eq(msgConversation.id, conversationId));
			if (!row?.linked) return null;
			const [o] = await tx
				.select({ userId: msgMember.userId })
				.from(msgMember)
				.where(and(eq(msgMember.conversationId, conversationId), ne(msgMember.userId, userId)));
			return o?.userId ?? '';
		});
		if (other !== null && !(other && (await partnerOf(userId, other))))
			throw new MessagesProblem('Esa familia ya no está vinculada');
	}

	/** Its people's devices, not revoked, in every family it is in. */
	async function devicesOf(tx: AnyDb, own: string, row: Row): Promise<Device[]> {
		const out: Device[] = [];
		for (const f of familiesOf(row))
			out.push(
				...(await inFamily(tx, own, f, () =>
					tx
						.select({
							deviceId: msgDevice.id,
							userId: msgDevice.userId,
							familyId: msgDevice.familyId
						})
						.from(msgDevice)
						.innerJoin(
							msgMember,
							and(eq(msgMember.userId, msgDevice.userId), eq(msgMember.conversationId, row.id))
						)
						.where(isNull(msgDevice.revokedAt))
						.orderBy(asc(msgDevice.createdAt))
				))
			);
		return out;
	}

	const view = (row: Row, epoch: number, devices: Device[]): ConversationView => ({
		id: row.id,
		kind: row.kind,
		epoch,
		devices: devices.map(({ deviceId, userId }) => ({ deviceId, userId }))
	});

	/** Its epoch, in the family that keeps it (locked for update if asked). */
	async function epochOf(tx: AnyDb, own: string, row: Row, lock = false) {
		return inFamily(tx, own, row.homeFamilyId, async () => {
			const q = tx
				.select({ epoch: msgConversation.epoch })
				.from(msgConversation)
				.where(eq(msgConversation.id, row.id));
			const [r] = lock ? await q.for('update') : await q;
			if (!r) throw new MessagesProblem('No hay esa conversación');
			return r.epoch;
		});
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

		/** The conversations this person is in, here. */
		async conversations(userId: string): Promise<ConversationListed[]> {
			return withFamily(userId, async (tx) => {
				const mine = await tx
					.select({ id: msgConversation.id, kind: msgConversation.kind })
					.from(msgConversation)
					.innerJoin(
						msgMember,
						and(eq(msgMember.conversationId, msgConversation.id), eq(msgMember.userId, userId))
					);
				const ids = mine.filter((c) => c.kind === 'pareja').map((c) => c.id);
				const others = ids.length
					? await tx
							.select({ id: msgMember.conversationId, userId: msgMember.userId })
							.from(msgMember)
							.where(and(inArray(msgMember.conversationId, ids), ne(msgMember.userId, userId)))
					: [];
				return mine.map((c) => ({ ...c, with: others.find((o) => o.id === c.id)?.userId ?? null }));
			});
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
				const row = await convOf(tx, userId, id);
				return {
					...view(row, row.epoch, await devicesOf(tx, m.familyId, row)),
					created: made.length > 0
				};
			});
		},

		/**
		 * Two people's conversation, made the first time: of the same family, or of linked ones, kept in
		 * both. Only with someone this person may write to.
		 */
		async pairConversation(
			userId: string,
			deviceId: string,
			otherId: string
		): Promise<ConversationView> {
			if (otherId === userId) throw new MessagesProblem('Contigo mismo, no');
			const partner = await partnerOf(userId, otherId);
			if (!partner) throw new MessagesProblem('No puedes escribir a esa persona desde aquí');
			const id = pairConversationId(userId, otherId);
			return withFamily(userId, async (tx, m) => {
				await ownDevice(tx, userId, deviceId);
				const linked = partner.familyId === m.familyId ? null : partner.familyId;
				const home = linked ? [m.familyId, linked].sort()[0]! : m.familyId;
				for (const f of [m.familyId, ...(linked ? [linked] : [])])
					await inFamily(tx, m.familyId, f, async () => {
						await tx
							.insert(msgConversation)
							.values({
								id,
								familyId: f,
								kind: 'pareja',
								homeFamilyId: home,
								linkedFamilyId: linked ? (f === m.familyId ? linked : m.familyId) : null
							})
							.onConflictDoNothing();
						await tx
							.insert(msgMember)
							.values(
								[userId, otherId].map((u) => ({ conversationId: id, familyId: f, userId: u }))
							)
							.onConflictDoNothing();
					});
				const row = await convOf(tx, userId, id);
				return view(row, await epochOf(tx, m.familyId, row), await devicesOf(tx, m.familyId, row));
			});
		},

		/** Its group as it should be now, to compare with the one the device holds. */
		async conversation(
			userId: string,
			deviceId: string,
			conversationId: string
		): Promise<ConversationView> {
			return withFamily(userId, async (tx, m) => {
				await ownDevice(tx, userId, deviceId);
				const row = await convOf(tx, userId, conversationId);
				return view(row, await epochOf(tx, m.familyId, row), await devicesOf(tx, m.familyId, row));
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
			await stillLinked(userId, conversationId);
			return withFamily(userId, async (tx, m) => {
				await ownDevice(tx, userId, deviceId);
				const row = await convOf(tx, userId, conversationId);
				const allowed = new Map(
					(await devicesOf(tx, m.familyId, row)).map((d) => [d.deviceId, d.familyId])
				);
				const out: Record<string, string> = {};
				for (const id of deviceIds) {
					const f = allowed.get(id);
					if (!f) continue;
					const data = await inFamily(tx, m.familyId, f, async () => {
						const [kp] = await tx
							.select({ id: msgKeyPackage.id, data: msgKeyPackage.data })
							.from(msgKeyPackage)
							.where(eq(msgKeyPackage.deviceId, id))
							.orderBy(asc(msgKeyPackage.id))
							.limit(1)
							.for('update', { skipLocked: true });
						if (kp) await tx.delete(msgKeyPackage).where(eq(msgKeyPackage.id, kp.id));
						return kp?.data;
					});
					if (data) out[id] = data;
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
			await stillLinked(userId, c.conversationId);
			return withFamily(userId, async (tx, m) => {
				await ownDevice(tx, userId, deviceId);
				const row = await convOf(tx, userId, c.conversationId);
				const families = familiesOf(row);
				await lockQueues(tx, families);
				const epoch = await epochOf(tx, m.familyId, row, true);
				if (epoch !== c.epoch) return { ok: false, epoch, familyIds: families };
				const next = c.epoch + 1;
				for (const f of families)
					await inFamily(tx, m.familyId, f, async () => {
						await tx
							.update(msgConversation)
							.set({ epoch: next })
							.where(eq(msgConversation.id, c.conversationId));
						await tx.insert(msgEvent).values({
							familyId: f,
							conversationId: c.conversationId,
							kind: 'commit',
							epoch: c.epoch,
							senderDevice: deviceId,
							data: c.commit
						});
						if (c.welcome && c.recipients?.length)
							await tx.insert(msgEvent).values({
								familyId: f,
								conversationId: c.conversationId,
								kind: 'welcome',
								epoch: next,
								senderDevice: deviceId,
								recipients: c.recipients.filter(isId),
								data: c.welcome
							});
					});
				return { ok: true, epoch: next, familyIds: families };
			});
		},

		/** A message, encrypted by the device: in every family it is in; who else is in it, to tell them. */
		async postMessage(
			userId: string,
			deviceId: string,
			msg: { conversationId: string; epoch: number; data: string }
		) {
			if (!isB64(msg.data)) throw new MessagesProblem('Mensaje no válido');
			await stillLinked(userId, msg.conversationId);
			return withFamily(userId, async (tx, m) => {
				await ownDevice(tx, userId, deviceId);
				const row = await convOf(tx, userId, msg.conversationId);
				const families = familiesOf(row);
				await lockQueues(tx, families);
				// Made on an epoch the group has left: nobody could read it. Said, to catch up and resend.
				const epoch = await epochOf(tx, m.familyId, row);
				if (epoch !== msg.epoch)
					return { id: 0, stale: true as const, epoch, familyIds: families, to: [] };
				let id = 0;
				for (const f of families)
					await inFamily(tx, m.familyId, f, async () => {
						const [ev] = await tx
							.insert(msgEvent)
							.values({
								familyId: f,
								conversationId: msg.conversationId,
								kind: 'app',
								epoch: msg.epoch,
								senderDevice: deviceId,
								data: msg.data
							})
							.returning({ id: msgEvent.id });
						if (f === m.familyId) id = ev!.id;
					});
				const others = await tx
					.select({ userId: msgMember.userId })
					.from(msgMember)
					.where(
						and(eq(msgMember.conversationId, msg.conversationId), ne(msgMember.userId, userId))
					);
				// With a linked family, the other one is of it, and told in theirs.
				const to = others.map((o) => ({
					userId: o.userId,
					familyId: row.linkedFamilyId ?? m.familyId
				}));
				return { id, familyIds: families, to };
			});
		},

		/**
		 * A file of a conversation (a voice note, a photo), encrypted by the device: its id (its name in the family's
		 * storage, area `mensajes`), and the family whose storage keeps it.
		 */
		async addFile(userId: string, deviceId: string, conversationId: string, size: number) {
			if (!Number.isInteger(size) || size <= 0 || size > MAX_FILE_BYTES)
				throw new MessagesProblem('Archivo demasiado grande');
			return withFamily(userId, async (tx, m) => {
				await ownDevice(tx, userId, deviceId);
				await convOf(tx, userId, conversationId);
				const id = crypto.randomUUID();
				await tx.insert(msgFile).values({ id, familyId: m.familyId, conversationId, userId, size });
				return { id, familyId: m.familyId };
			});
		},

		/** The upload did not go through (no room): not kept. */
		async dropFile(userId: string, fileId: string) {
			await withFamily(userId, (tx) =>
				tx.delete(msgFile).where(and(eq(msgFile.id, fileId), eq(msgFile.userId, userId)))
			);
		},

		/**
		 * Where a file of a conversation this person is in is kept: that family's id; else a
		 * problem. With a linked family, it may be in the other's.
		 */
		async fileFor(userId: string, conversationId: string, fileId: string) {
			return withFamily(userId, async (tx, m) => {
				const row = await convOf(tx, userId, conversationId);
				for (const f of familiesOf(row)) {
					const found = await inFamily(tx, m.familyId, f, async () => {
						const [file] = await tx
							.select({ familyId: msgFile.familyId })
							.from(msgFile)
							.where(and(eq(msgFile.id, fileId), eq(msgFile.conversationId, conversationId)));
						return file?.familyId ?? null;
					});
					if (found) return found;
				}
				throw new MessagesProblem('No hay ese archivo');
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
