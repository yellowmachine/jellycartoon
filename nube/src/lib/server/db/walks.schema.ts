import {
	index,
	integer,
	jsonb,
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
