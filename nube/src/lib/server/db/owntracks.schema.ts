import { sql } from 'drizzle-orm';
import {
	date,
	integer,
	pgPolicy,
	pgTable,
	primaryKey,
	real,
	text,
	timestamp
} from 'drizzle-orm/pg-core';
import { user } from './auth.schema.ts';
import { userRows } from './user.schema.ts';

/**
 * OwnTracks (#593): the person's phone sending where it is, in the background, to
 * `/api/owntracks`. Of the person and of no family, like what is in user.schema.ts: no one else
 * sees it, and it goes with them if they change family.
 */

/**
 * Their connection: the password their OwnTracks sends (Basic auth), kept only as its SHA-256.
 * One per person; a new one replaces it and the old stops working. The endpoint, with no session,
 * finds whose it is by that hash alone (`app.key_hash`, as the bank's calls, #502).
 */
export const owntracksLink = pgTable(
	'owntracks_link',
	{
		userId: text('user_id')
			.primaryKey()
			.references(() => user.id, { onDelete: 'cascade' }),
		tokenHash: text('token_hash').notNull().unique(),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		userRows('owntracks_link_own', t.userId),
		pgPolicy('owntracks_link_by_hash', {
			for: 'select',
			using: sql`${t.tokenHash} = nullif(current_setting('app.key_hash', true), '')`
		})
	]
).enableRLS();

/**
 * Each position it sent. What makes one unique is its person and its moment: OwnTracks sends
 * again what it could not send without coverage, so the same one may come twice, and late.
 */
export const locationPoint = pgTable(
	'location_point',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** When the phone took it (`tst`), not when it arrived. */
		at: timestamp('at').notNull(),
		lon: real('lon').notNull(),
		lat: real('lat').notNull(),
		/** Metres of accuracy (`acc`): how far it may be from where it says. */
		accuracy: integer('accuracy'),
		/** km/h (`vel`), as the phone measured it; some phones never send it. */
		speed: integer('speed'),
		/** Metres (`alt`). */
		altitude: integer('altitude'),
		/** Battery, % (`batt`). */
		battery: integer('battery'),
		/** Which phone (`X-Limit-D`, or its `tid`). */
		device: text('device'),
		receivedAt: timestamp('received_at').notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.userId, t.at] }), userRows('location_point_own', t.userId)]
).enableRLS();

/**
 * What is left of a day once its positions are forgotten (phase 3, after KEEP_DAYS): how much
 * was walked, as Paseos → OwnTracks worked it out (owntracks-walking.ts). Only days with positions.
 */
export const owntracksDay = pgTable(
	'owntracks_day',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** The house's day. */
		day: date('day').notNull(),
		/** Metres walking. */
		distance: real('distance').notNull().default(0),
		/** Seconds walking. */
		seconds: integer('seconds').notNull().default(0),
		outings: integer('outings').notNull().default(0),
		/** How many positions came that day. */
		points: integer('points').notNull().default(0)
	},
	(t) => [primaryKey({ columns: [t.userId, t.day] }), userRows('owntracks_day_own', t.userId)]
).enableRLS();

/**
 * Arriving at or leaving one of their places (phase 4), as the phone told it (`transition`): what
 * fires their rules «lugar», and what the day shows. The same one sent twice, kept once.
 */
export const owntracksEvent = pgTable(
	'owntracks_event',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** When it happened on the phone (`tst`). */
		at: timestamp('at').notNull(),
		/** The place's name, as the phone has it (`desc`): «Casa». */
		place: text('place').notNull(),
		moment: text('moment').$type<'llega' | 'sale'>().notNull()
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.at, t.place] }),
		userRows('owntracks_event_own', t.userId)
	]
).enableRLS();
