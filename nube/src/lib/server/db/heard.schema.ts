import { index, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth.schema.ts';
import { family, familyRows } from './family.schema.ts';

/**
 * What was said to the voice these last days (#331, phase 7), only to see what repeats («pongo la
 * lavadora» every few days) and propose a rule for it. A person's, only theirs; on a satellite,
 * the house's. Kept two weeks (heard.ts).
 */
export const heard = pgTable(
	'heard',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		/** Whose; null, said on a satellite. */
		userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
		text: text('text').notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		index('heard_family_user_idx').on(t.familyId, t.userId, t.createdAt),
		familyRows('heard_own', t.familyId)
	]
).enableRLS();
