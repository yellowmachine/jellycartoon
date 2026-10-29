import { index, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { family, familyRows } from './family.schema.ts';

/**
 * What the voice has learned from its own questions: «media hora», asked on the bedroom's
 * satellite, was a timer. Each by its place (a satellite, a person), written by the AI as a rule
 * for the next time, with the words that would bring it up (voice/learned.ts).
 */
export const voiceLearned = pgTable(
	'voice_learned',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		/** «satelite:<id>» or «user:<id>», as `AlarmPlace` and the «horas de silencio» say it. */
		place: text('place').notNull(),
		/** Its name when it was learned, for Ajustes: «satelite dormitorio», «Miguel». */
		placeName: text('place_name').notNull(),
		/** «Una duración sola es un temporizador». */
		title: text('title').notNull(),
		/** What the AI is told: «Si dice solo una duración ("media hora"), pon un temporizador». */
		rule: text('rule').notNull(),
		/** Folded, that a later order would have: «media», «hora», «minutos». */
		words: jsonb('words').$type<string[]>().notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		updatedAt: timestamp('updated_at').notNull().defaultNow()
	},
	(t) => [
		index('voice_learned_place_idx').on(t.familyId, t.place),
		familyRows('voice_learned_own', t.familyId)
	]
).enableRLS();
