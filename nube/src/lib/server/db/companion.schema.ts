import { sql } from 'drizzle-orm';
import {
	boolean,
	index,
	integer,
	pgTable,
	serial,
	text,
	time,
	timestamp
} from 'drizzle-orm/pg-core';
import { family, familyRows } from './family.schema.ts';

/**
 * «Compañía» (#469): for someone who lives alone, a satellite asks them now and then how they are
 * and waits for an answer; with none after a few tries, the linked families are told (#464). One
 * row per family: how it is set, and where the asking is now (what the clock goes on from after a
 * restart).
 */
export const companion = pgTable(
	'companion',
	{
		familyId: text('family_id')
			.primaryKey()
			.references(() => family.id, { onDelete: 'cascade' }),
		on: boolean('on').notNull().default(false),
		/** How the satellite calls them: «Carmen». */
		name: text('name').notNull().default(''),
		/** The satellites that ask; none, all the family's. */
		satelliteIds: text('satellite_ids')
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		everyMinutes: integer('every_minutes').notNull().default(30),
		/** Asked only between these, on the wall: never at night. */
		fromTime: time('from_time').notNull().default('09:00'),
		toTime: time('to_time').notNull().default('22:00'),
		/** Tries after the first, before telling the linked families. */
		retries: integer('retries').notNull().default(2),
		retryMinutes: integer('retry_minutes').notNull().default(2),
		/** Not asked until then: «me voy» by voice, or «Pausar» from a linked family. */
		pausedUntil: timestamp('paused_until'),
		/** Who paused it, as said: «por voz», «Ana». */
		pausedBy: text('paused_by'),
		/** The last sign of them: an answer, or anything said to a satellite. */
		lastSignalAt: timestamp('last_signal_at'),
		/** When the last asking ended, answered or not. */
		lastCheckAt: timestamp('last_check_at'),
		/** The asking going on: its try (0, none), when it started and when it was last asked. */
		attempt: integer('attempt').notNull().default(0),
		startedAt: timestamp('started_at'),
		askedAt: timestamp('asked_at'),
		/** What was asked, for the AI to judge the answer by. */
		question: text('question'),
		/** What the linked families have been told and not yet seen: no answer, or no satellite. */
		alertKind: text('alert_kind').$type<'silent' | 'offline'>(),
		alertSince: timestamp('alert_since'),
		/** Since when no satellite of theirs is connected (or none can ask), within the hours. */
		offlineSince: timestamp('offline_since')
	},
	(t) => [familyRows('companion_own', t.familyId)]
).enableRLS();

/** Each asking, for the history: answered or not. Never what was said (decided in #469). */
export const companionCheck = pgTable(
	'companion_check',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		at: timestamp('at').notNull().defaultNow(),
		answered: boolean('answered').notNull(),
		/** Whether the answer made sense, as the AI judged it; null, not judged. Only kept, for now. */
		coherent: boolean('coherent')
	},
	(t) => [
		index('companion_check_family_at_idx').on(t.familyId, t.at),
		familyRows('companion_check_own', t.familyId)
	]
).enableRLS();
