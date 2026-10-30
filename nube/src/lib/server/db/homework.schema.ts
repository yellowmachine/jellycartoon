import { index, jsonb, pgEnum, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import type { Exercise, HomeworkRules, Step } from 'comun/homework.ts';
import { user } from './auth.schema.ts';
import { family, familyRows } from './family.schema.ts';

export const homeworkStatus = pgEnum('homework_status', ['draft', 'assigned', 'done']);

/**
 * Homework from the cartoons a child watched (#142, moved from jellycartoon): proposed by the
 * family's AI from the episodes' dialogue (the house's), reviewed by an adult, done by the child.
 */
export const homework = pgTable(
	'homework',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		kidId: text('kid_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** The adult who prepared it; null if their account is gone. */
		createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
		status: homeworkStatus('status').notNull().default('draft'),
		/** «Dexter, T1 E1», as the child sees it. */
		title: text('title').notNull(),
		/** `es`, or `en` to practise English. */
		language: text('language').notNull().default('es'),
		/** AGE_BANDS' id (comun/homework.ts). */
		band: text('band').notNull(),
		/** The house's episodes it is about. */
		episodeIds: jsonb('episode_ids').$type<number[]>().notNull(),
		/** Their names, as the house gave them («Dexter», T1 E1 «…»), for the adult's review. */
		episodeNames: jsonb('episode_names').$type<Record<string, string>>().notNull().default({}),
		exercises: jsonb('exercises').$type<Exercise[]>().notNull().default([]),
		rules: jsonb('rules').$type<HomeworkRules>().notNull(),
		/** One per exercise, as the child goes. */
		steps: jsonb('steps').$type<Step[]>().notNull().default([]),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		assignedAt: timestamp('assigned_at'),
		doneAt: timestamp('done_at')
	},
	(t) => [index('homework_kid_idx').on(t.kidId, t.status), familyRows('homework_own', t.familyId)]
).enableRLS();
