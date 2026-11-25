import { date, pgTable, primaryKey, real, text } from 'drizzle-orm/pg-core';
import { user } from './auth.schema.ts';
import { userRows } from './user.schema.ts';

/**
 * What a person weighs, by the day they noted it, if they want the kcal of their walks (Paseos). Of
 * the person and of no family, like what is in user.schema.ts: no one else sees it.
 */
export const bodyWeight = pgTable(
	'body_weight',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		day: date('day').notNull(),
		kg: real('kg').notNull()
	},
	(t) => [primaryKey({ columns: [t.userId, t.day] }), userRows('body_weight_own', t.userId)]
).enableRLS();
