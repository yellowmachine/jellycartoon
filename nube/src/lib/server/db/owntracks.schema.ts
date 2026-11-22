import { sql } from 'drizzle-orm';
import { integer, pgPolicy, pgTable, primaryKey, real, text, timestamp } from 'drizzle-orm/pg-core';
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
