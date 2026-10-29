import { index, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth.schema.ts';
import { family, familyRows } from './family.schema.ts';

/**
 * What the family asked the voice to remember («la llave de repuesto está en la maceta»), to
 * answer with it later (memory.ts). A person's, only theirs: no one else sees it, not even the
 * family's administrator; without a person, the whole house's.
 */
export const memory = pgTable(
	'memory',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		/** Whose; null, the house's (said on a satellite, or for everyone). */
		userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
		/** As it is to be told: «La llave de repuesto está en la maceta de la entrada». */
		text: text('text').notNull(),
		/** Folded, to find it by the words of a question. */
		words: jsonb('words').$type<string[]>().notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		updatedAt: timestamp('updated_at').notNull().defaultNow()
	},
	(t) => [
		index('memory_family_user_idx').on(t.familyId, t.userId),
		familyRows('memory_own', t.familyId)
	]
).enableRLS();
