import { index, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
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
	(t) => [index('paper_family_idx').on(t.familyId), familyRows('paper_own', t.familyId)]
).enableRLS();
