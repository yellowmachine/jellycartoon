import {
	bigserial,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	serial,
	text,
	timestamp
} from 'drizzle-orm/pg-core';
import { user } from './auth.schema.ts';
import { family, familyRows } from './family.schema.ts';

/**
 * Mensajes (#551): the family's own messages, end-to-end encrypted with MLS (RFC 9420, ts-mls) in
 * each device. Seilide only keeps and hands out what the devices give it: their public key packages,
 * which conversations there are and who is in each, and a queue of encrypted events (the group's
 * changes and the messages) in the order they must be read. It never has a key to read them.
 *
 * Each family its own rows (RLS by family, as the calls); a conversation with a linked family, in
 * both, with the same id. Another person of the family could read the rows of a conversation they
 * are not in: they only hold ciphertext, and the code only gives each one their own.
 */

/** A person's device with messages on: its MLS identity is `<userId>/<deviceId>`. */
export const msgDevice = pgTable(
	'msg_device',
	{
		/** Made by the device itself (a UUID), kept in its IndexedDB. */
		id: text('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** As shown: «Móvil», «Tablet del coche»… */
		name: text('name').notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		seenAt: timestamp('seen_at').notNull().defaultNow(),
		/** Lost or taken out: the groups take it out at their next change. */
		revokedAt: timestamp('revoked_at')
	},
	(t) => [
		index('msg_device_user_idx').on(t.familyId, t.userId),
		familyRows('msg_device_own', t.familyId)
	]
).enableRLS();

/** A device's public key packages, each used once to add it to a group. */
export const msgKeyPackage = pgTable(
	'msg_key_package',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		deviceId: text('device_id')
			.notNull()
			.references(() => msgDevice.id, { onDelete: 'cascade' }),
		/** The MLS key package message, base64. */
		data: text('data').notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		index('msg_key_package_device_idx').on(t.deviceId),
		familyRows('msg_key_package_own', t.familyId)
	]
).enableRLS();

/**
 * A conversation: the whole family's, or two people's. Its id is the MLS group's. `epoch` counts
 * the group's changes, kept by the family it was made in (`homeFamilyId`): one change per epoch is
 * accepted, so every device applies them in the same order.
 */
export const msgConversation = pgTable(
	'msg_conversation',
	{
		id: text('id').notNull(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		kind: text('kind').$type<'familia' | 'pareja'>().notNull(),
		homeFamilyId: text('home_family_id').notNull(),
		/** Two people of linked families (#464): the other family, which has the same rows. */
		linkedFamilyId: text('linked_family_id'),
		epoch: integer('epoch').notNull().default(0),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.id, t.familyId] }),
		familyRows('msg_conversation_own', t.familyId)
	]
).enableRLS();

/** Who is in a conversation: its devices are theirs, not revoked. */
export const msgMember = pgTable(
	'msg_member',
	{
		conversationId: text('conversation_id').notNull(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' })
	},
	(t) => [
		primaryKey({ columns: [t.conversationId, t.familyId, t.userId] }),
		index('msg_member_user_idx').on(t.familyId, t.userId),
		familyRows('msg_member_own', t.familyId)
	]
).enableRLS();

/**
 * The queue: what each device reads after its last one, in order. A `welcome` is for the devices in
 * `recipients`; a `commit` (a change of the group) and an `app` (a message) for every device in the
 * conversation. All of it encrypted by the devices; only the order and who sent it are Seilide's.
 */
export const msgEvent = pgTable(
	'msg_event',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		conversationId: text('conversation_id').notNull(),
		kind: text('kind').$type<'welcome' | 'commit' | 'app'>().notNull(),
		/** The group's epoch it was made in (a commit's: the one it ends). */
		epoch: integer('epoch').notNull(),
		senderDevice: text('sender_device').notNull(),
		/** A welcome's: the devices it adds. */
		recipients: jsonb('recipients').$type<string[]>(),
		/** The MLS message, base64. */
		data: text('data').notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		index('msg_event_family_idx').on(t.familyId, t.id),
		index('msg_event_conversation_idx').on(t.familyId, t.conversationId, t.id),
		familyRows('msg_event_own', t.familyId)
	]
).enableRLS();

/**
 * A person's backup of what their devices have read (#551): encrypted in the device with a key that
 * comes from their PIN (at least 6 digits) through an OPRF with this row's key, so the PIN cannot be
 * tried without the server, which counts the tries (`tries`) and wipes the backup after too many. The
 * server keeps only the OPRF key (sealed with the family's key, family-secret.ts), the hash of the
 * proof the device shows when it knows the PIN (`verifier`), and the ciphertext.
 */
export const msgBackup = pgTable(
	'msg_backup',
	{
		userId: text('user_id')
			.primaryKey()
			.references(() => user.id, { onDelete: 'cascade' }),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		/** The OPRF's private key (P-256), sealed. */
		oprfKey: text('oprf_key').notNull(),
		/** SHA-256 of the proof key the PIN gives, base64; null, no backup yet. */
		verifier: text('verifier'),
		/** The backup, encrypted in the device (AES-GCM, iv first), base64. */
		blob: text('blob'),
		/** PIN tries since the last right one. */
		tries: integer('tries').notNull().default(0),
		updatedAt: timestamp('updated_at').notNull().defaultNow()
	},
	(t) => [familyRows('msg_backup_own', t.familyId)]
).enableRLS();
