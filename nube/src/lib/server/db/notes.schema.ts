import {
	index,
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
import { walk } from './walks.schema.ts';

/**
 * Notes (#416): what someone dictates, to look it up when they ask for it; the voice does not use
 * them by itself, as it does with its memory. Recorded here or on a walk, with their audio and what
 * was heard in it; or said to the voice, only as text. A person's, only theirs; without a person
 * (said to a satellite), the whole house's.
 */
export const note = pgTable(
	'note',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		/** Whose; null, the house's. */
		userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
		/** The device's own id for it: sent twice (the answer got lost), it is kept once. */
		clientId: text('client_id'),
		text: text('text').notNull().default(''),
		/** Whether what the audio says has been heard yet. */
		hearing: text('hearing', { enum: ['ready', 'pending', 'failed'] })
			.notNull()
			.default('ready'),
		/** Its file in the family's storage, if it was recorded. */
		audio: text('audio'),
		source: text('source', { enum: ['pagina', 'paseo', 'voz'] }).notNull(),
		/** The walk it was recorded on: the walk gone, the note stays, with its place. */
		walkId: integer('walk_id').references(() => walk.id, { onDelete: 'set null' }),
		lon: real('lon'),
		lat: real('lat'),
		/** When it was said, not when it arrived: a walk can go without coverage. */
		at: timestamp('at').notNull().defaultNow()
	},
	(t) => [
		unique('note_user_client').on(t.userId, t.clientId),
		index('note_family_user_at_idx').on(t.familyId, t.userId, t.at),
		index('note_walk_idx').on(t.walkId),
		familyRows('note_own', t.familyId)
	]
).enableRLS();
