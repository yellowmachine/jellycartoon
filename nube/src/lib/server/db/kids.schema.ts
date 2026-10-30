import {
	index,
	integer,
	pgEnum,
	pgTable,
	primaryKey,
	serial,
	text,
	timestamp
} from 'drizzle-orm/pg-core';
import { user } from './auth.schema.ts';
import { family, familyRows } from './family.schema.ts';

/**
 * Children's accounts (#303): a person of the family (family_person) given an account with the
 * role `peque` (family_member). It has no email of its own nor a password it knows: it enters
 * with a credential only the server knows (kept encrypted, secret-box.ts), when one of its adults
 * lets it in, as the house does (#141).
 */
export const kidAccount = pgTable(
	'kid_account',
	{
		userId: text('user_id')
			.primaryKey()
			.references(() => user.id, { onDelete: 'cascade' }),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		/** Its credential, encrypted: what the server signs it in with. */
		secret: text('secret').notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [familyRows('kid_account_own', t.familyId)]
).enableRLS();

/** Who lets each child in: adults of its family, chosen by its administrator. */
export const kidGuardian = pgTable(
	'kid_guardian',
	{
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		kidId: text('kid_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		guardianId: text('guardian_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' })
	},
	(t) => [
		primaryKey({ columns: [t.kidId, t.guardianId] }),
		index('kid_guardian_guardian_idx').on(t.guardianId),
		familyRows('kid_guardian_own', t.familyId)
	]
).enableRLS();

/**
 * Where children enter by choosing their drawing (#303): devices its administrator marked as the
 * family's (the children's tablet, the computer), by a cookie only they have (its hash here).
 */
export const trustedDevice = pgTable(
	'trusted_device',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		tokenHash: text('token_hash').notNull().unique(),
		name: text('name').notNull(),
		createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		lastSeenAt: timestamp('last_seen_at').notNull().defaultNow()
	},
	(t) => [familyRows('trusted_device_own', t.familyId)]
).enableRLS();

export const kidRequestState = pgEnum('kid_request_state', [
	'pending',
	'approved',
	'denied',
	'used'
]);

/** A child asking to enter on one of them: its adults answer, or it expires. */
export const kidLoginRequest = pgTable(
	'kid_login_request',
	{
		id: text('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		kidId: text('kid_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		deviceId: integer('device_id')
			.notNull()
			.references(() => trustedDevice.id, { onDelete: 'cascade' }),
		state: kidRequestState('state').notNull().default('pending'),
		expiresAt: timestamp('expires_at').notNull(),
		decidedBy: text('decided_by').references(() => user.id, { onDelete: 'set null' }),
		/** Approved: until when its session lasts. */
		until: timestamp('until'),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		index('kid_login_request_device_idx').on(t.deviceId, t.createdAt),
		familyRows('kid_login_request_own', t.familyId)
	]
).enableRLS();

/** «Un rato» or «hoy»: on that device it enters again without asking, until then. */
export const kidPermit = pgTable(
	'kid_permit',
	{
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		kidId: text('kid_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		deviceId: integer('device_id')
			.notNull()
			.references(() => trustedDevice.id, { onDelete: 'cascade' }),
		until: timestamp('until').notNull(),
		grantedBy: text('granted_by').references(() => user.id, { onDelete: 'set null' })
	},
	(t) => [primaryKey({ columns: [t.kidId, t.deviceId] }), familyRows('kid_permit_own', t.familyId)]
).enableRLS();
