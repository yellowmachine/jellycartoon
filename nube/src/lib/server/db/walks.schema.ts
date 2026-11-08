import { sql } from 'drizzle-orm';
import {
	boolean,
	index,
	integer,
	jsonb,
	pgPolicy,
	pgTable,
	real,
	serial,
	text,
	timestamp,
	unique
} from 'drizzle-orm/pg-core';
import { user } from './auth.schema.ts';
import { family, familyRows } from './family.schema.ts';
import type { WalkDiagnosis } from '#lib/walks.ts';

/**
 * Paseos (#410): each person's walks, private to them. Sent whole when finished, so what makes one
 * unique is its person and the moment it started: sent twice, it is kept once.
 */
export const walk = pgTable(
	'walk',
	{
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		id: serial('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** «Empezar» and «Terminar» pressed: its time, whatever the GPS did. */
		startedAt: timestamp('started_at').notNull(),
		endedAt: timestamp('ended_at').notNull(),
		/** Metres, along its positions. */
		distance: real('distance').notNull().default(0),
		/** How many positions it kept, to list them without their line. */
		points: integer('points').notNull().default(0),
		/** Its positions, [longitude, latitude, seconds since 1970]. */
		line: jsonb('line').$type<[number, number, number][]>().notNull().default([]),
		/** What the GPS did: whether it went on with the screen off. */
		diagnosis: jsonb('diagnosis').$type<WalkDiagnosis>().notNull()
	},
	(t) => [
		unique('walk_user_started').on(t.userId, t.startedAt),
		index('walk_user_started_idx').on(t.userId, t.startedAt),
		familyRows('walk_own', t.familyId)
	]
).enableRLS();

/** The photos taken on a walk (#416), where they were taken: private to their person, as the walk. */
export const walkPhoto = pgTable(
	'walk_photo',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		walkId: integer('walk_id')
			.notNull()
			.references(() => walk.id, { onDelete: 'cascade' }),
		/** The device's own id for it: sent twice (the answer got lost), it is kept once. */
		clientId: text('client_id').notNull(),
		/** Its file in the family's storage. */
		file: text('file').notNull(),
		lon: real('lon'),
		lat: real('lat'),
		at: timestamp('at').notNull()
	},
	(t) => [
		unique('walk_photo_user_client').on(t.userId, t.clientId),
		index('walk_photo_walk_idx').on(t.walkId),
		familyRows('walk_photo_own', t.familyId)
	]
).enableRLS();

/**
 * A walk shared by link (#434): for whoever has it, until it is taken back («Retirar») or the walk
 * is deleted. Kept by its token's SHA-256 only: the link is shown once. The page that opens it
 * finds it by that hash (`app.share_hash`), all its policy lets it see without a family, and only
 * then reads the walk in its family (share-scope.ts).
 */
export const walkShare = pgTable(
	'walk_share',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		/** Who shared it: the walk's own person. */
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		walkId: integer('walk_id')
			.notNull()
			.references(() => walk.id, { onDelete: 'cascade' }),
		tokenHash: text('token_hash').notNull().unique(),
		/** «Grupo del cole», «Mamá»: to know it again in the list. */
		label: text('label'),
		/** The photos it shows, chosen when it was made. */
		photoIds: jsonb('photo_ids').$type<number[]>().notNull().default([]),
		/** Without its ends, near home (walk-share.ts). */
		trim: boolean('trim').notNull().default(true),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		opens: integer('opens').notNull().default(0),
		lastOpenedAt: timestamp('last_opened_at'),
		revokedAt: timestamp('revoked_at')
	},
	(t) => [
		index('walk_share_user_idx').on(t.userId),
		index('walk_share_walk_idx').on(t.walkId),
		familyRows('walk_share_own', t.familyId),
		pgPolicy('walk_share_by_token', {
			for: 'select',
			using: sql`${t.tokenHash} = nullif(current_setting('app.share_hash', true), '')`
		})
	]
).enableRLS();
