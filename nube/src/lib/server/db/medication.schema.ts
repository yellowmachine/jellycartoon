import { sql } from 'drizzle-orm';
import {
	date,
	foreignKey,
	index,
	integer,
	pgTable,
	primaryKey,
	serial,
	text,
	time,
	timestamp,
	unique
} from 'drizzle-orm/pg-core';
import { familyPerson } from './agenda.schema.ts';
import { user } from './auth.schema.ts';
import { family, familyRows } from './family.schema.ts';

/**
 * The family's medication (#308): what each person takes and when, and each dose marked as taken.
 * Times and days on the wall, in the family's time zone (`TZ`), as the agenda's.
 */

const familyId = () =>
	text('family_id')
		.notNull()
		.references(() => family.id, { onDelete: 'cascade' });

export const medication = pgTable(
	'medication',
	{
		id: serial('id').primaryKey(),
		familyId: familyId(),
		personId: integer('person_id').notNull(),
		name: text('name').notNull(),
		/** As said: «½ pastilla», «5 ml». */
		dose: text('dose'),
		/** Its doses' times, in order. */
		times: time('times').array().notNull(),
		/** The weekdays it is taken (0, Monday); none, every day. */
		days: integer('days')
			.array()
			.notNull()
			.default(sql`'{}'::integer[]`),
		startDay: date('start_day').notNull(),
		/** Its last day (an antibiotic's seven); null, no end. */
		endDay: date('end_day'),
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		unique('medication_family_id').on(t.familyId, t.id),
		foreignKey({
			name: 'medication_person_fk',
			columns: [t.familyId, t.personId],
			foreignColumns: [familyPerson.familyId, familyPerson.id]
		}).onDelete('cascade'),
		familyRows('medication_own', t.familyId)
	]
).enableRLS();

/**
 * A dose of a day: made when its notice goes (so it goes once), or when it is marked before.
 * Taken, while `takenAt` has a time.
 */
export const medicationDose = pgTable(
	'medication_dose',
	{
		familyId: familyId(),
		medicationId: integer('medication_id').notNull(),
		day: date('day').notNull(),
		time: time('time').notNull(),
		notifiedAt: timestamp('notified_at'),
		takenAt: timestamp('taken_at'),
		takenBy: text('taken_by').references(() => user.id, { onDelete: 'set null' })
	},
	(t) => [
		primaryKey({ columns: [t.medicationId, t.day, t.time] }),
		index('medication_dose_day_idx').on(t.familyId, t.day),
		foreignKey({
			name: 'medication_dose_medication_fk',
			columns: [t.familyId, t.medicationId],
			foreignColumns: [medication.familyId, medication.id]
		}).onDelete('cascade'),
		familyRows('medication_dose_own', t.familyId)
	]
).enableRLS();
