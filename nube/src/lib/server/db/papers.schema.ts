import {
	foreignKey,
	index,
	integer,
	pgTable,
	primaryKey,
	serial,
	text,
	timestamp,
	unique
} from 'drizzle-orm/pg-core';
import { calendarEvent } from './agenda.schema.ts';
import { user } from './auth.schema.ts';
import { family, familyRows } from './family.schema.ts';

/**
 * The family's Papeles (#384): a rent contract, an insurance policy. Its name and its notes kept
 * sealed with the family's data key (family-secret.ts), as its file in the family's storage
 * (storage.ts, `papeles`): here, only what cannot be read without the KMS, its category and
 * who wrote it down.
 */
export const paper = pgTable(
	'paper',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		/** Sealed: «Contrato de alquiler». */
		name: text('name').notNull(),
		/** One of PAPER_CATEGORIES (comun/papers.ts). */
		category: text('category').notNull(),
		/** Sealed, free text; null, none. */
		notes: text('notes'),
		/** Its file's name in the family's storage, whose extension says what it is. */
		file: text('file').notNull(),
		/** Who wrote it down; null if their account is gone. */
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		index('paper_family_idx').on(t.familyId),
		unique('paper_family_id').on(t.familyId, t.id),
		familyRows('paper_own', t.familyId)
	]
).enableRLS();

/**
 * The agenda's events a paper belongs to (#399): the appointment and its lab request. Only the
 * link goes with either of them, so a paper outlives its event. Both of its own family: foreign
 * keys are checked without row security.
 */
export const paperEvent = pgTable(
	'paper_event',
	{
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		paperId: integer('paper_id').notNull(),
		eventId: integer('event_id').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.paperId, t.eventId] }),
		index('paper_event_event_idx').on(t.eventId),
		foreignKey({
			name: 'paper_event_paper_fk',
			columns: [t.familyId, t.paperId],
			foreignColumns: [paper.familyId, paper.id]
		}).onDelete('cascade'),
		foreignKey({
			name: 'paper_event_event_fk',
			columns: [t.familyId, t.eventId],
			foreignColumns: [calendarEvent.familyId, calendarEvent.id]
		}).onDelete('cascade'),
		familyRows('paper_event_own', t.familyId)
	]
).enableRLS();
