import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { family, familyRows } from './family.schema.ts';

/**
 * Each family's data key (#326): the key its secrets are encrypted with (family-secret.ts), kept
 * only wrapped by the KMS (Scaleway Key Manager), bound to the family. A copy of the database alone
 * cannot unwrap it: that takes asking the KMS, which answers only the VPS. Made the first time a
 * secret of the family is kept with the KMS on; without the KMS, none.
 */
export const familyDataKey = pgTable(
	'family_data_key',
	{
		familyId: text('family_id')
			.primaryKey()
			.references(() => family.id, { onDelete: 'cascade' }),
		/** As the KMS gave it back: its ciphertext. */
		wrapped: text('wrapped').notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [familyRows('family_data_key_own', t.familyId)]
).enableRLS();
