import {
	foreignKey,
	integer,
	pgTable,
	real,
	serial,
	text,
	timestamp,
	unique
} from 'drizzle-orm/pg-core';
import { user } from './auth.schema.ts';
import { family, familyRows } from './family.schema.ts';

/**
 * Oración (#339): texts pasted to pray (litanies, prayers from vatican.va), each read aloud once by
 * one of the family's named voices and kept (storage.ts, `oracion`), and lists that chain them.
 * Only with Ajustes → Familia → Oración on (`family_settings.prayer_mode`).
 */

const familyId = () =>
	text('family_id')
		.notNull()
		.references(() => family.id, { onDelete: 'cascade' });

/** A voice with a name: one of Gemini's (`AI_VOICES`) and how it says things («Rosario: pausado»). */
export const prayerVoice = pgTable(
	'prayer_voice',
	{
		id: serial('id').primaryKey(),
		familyId: familyId(),
		name: text('name').notNull(),
		voice: text('voice').notNull(),
		tone: text('tone').notNull().default(''),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		unique('prayer_voice_family_id').on(t.familyId, t.id),
		familyRows('prayer_voice_own', t.familyId)
	]
).enableRLS();

/**
 * A text and its recording. Recorded with what `audioKey` says (its text, voice and tone): if they
 * change, it is still there, but «Ha cambiado». `generatingSince`: being recorded, since then.
 */
export const prayer = pgTable(
	'prayer',
	{
		id: serial('id').primaryKey(),
		familyId: familyId(),
		title: text('title').notNull(),
		text: text('text').notNull(),
		/** A voice in use is not deleted (prayers.ts): restrict, not set null. */
		voiceId: integer('voice_id').notNull(),
		/** Its name in the family's files (`oracion`); null, never recorded. */
		audioFile: text('audio_file'),
		audioKey: text('audio_key'),
		durationSec: real('duration_sec'),
		generatingSince: timestamp('generating_since'),
		/** Why the last recording failed, said for a person; null, it did not. */
		audioError: text('audio_error'),
		createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		unique('prayer_family_id').on(t.familyId, t.id),
		foreignKey({
			name: 'prayer_voice_fk',
			columns: [t.familyId, t.voiceId],
			foreignColumns: [prayerVoice.familyId, prayerVoice.id]
		}).onDelete('restrict'),
		familyRows('prayer_own', t.familyId)
	]
).enableRLS();

/** A list to pray, its texts one after the other with `pauseSec` of silence between them. */
export const prayerList = pgTable(
	'prayer_list',
	{
		id: serial('id').primaryKey(),
		familyId: familyId(),
		title: text('title').notNull(),
		pauseSec: integer('pause_sec').notNull().default(3),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		unique('prayer_list_family_id').on(t.familyId, t.id),
		familyRows('prayer_list_own', t.familyId)
	]
).enableRLS();

/** A text in a list, at `position`, said `times` times (an Ave María, ten). */
export const prayerListItem = pgTable(
	'prayer_list_item',
	{
		id: serial('id').primaryKey(),
		familyId: familyId(),
		listId: integer('list_id').notNull(),
		prayerId: integer('prayer_id').notNull(),
		position: integer('position').notNull(),
		times: integer('times').notNull().default(1)
	},
	(t) => [
		foreignKey({
			name: 'prayer_list_item_list_fk',
			columns: [t.familyId, t.listId],
			foreignColumns: [prayerList.familyId, prayerList.id]
		}).onDelete('cascade'),
		// A text deleted leaves the lists it was in.
		foreignKey({
			name: 'prayer_list_item_prayer_fk',
			columns: [t.familyId, t.prayerId],
			foreignColumns: [prayer.familyId, prayer.id]
		}).onDelete('cascade'),
		familyRows('prayer_list_item_own', t.familyId)
	]
).enableRLS();
