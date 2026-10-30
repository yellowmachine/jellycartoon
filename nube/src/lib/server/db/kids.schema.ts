import { index, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth.schema.ts';
import { family, familyRows } from './family.schema.ts';

/**
 * Children's accounts (#303): a person of the family (family_person) given an account with the
 * role `peque` (family_member). It has no email of its own nor a password it knows: it enters
 * with a credential only the server knows (kept encrypted, secret-box.ts), when one of its adults
 * lets it in, as the house does (#141).
 */
export const kidAccount = pgTable(
	'kid_account',
	{
		userId: text('user_id')
			.primaryKey()
			.references(() => user.id, { onDelete: 'cascade' }),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		/** Its credential, encrypted: what the server signs it in with. */
		secret: text('secret').notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [familyRows('kid_account_own', t.familyId)]
).enableRLS();

/** Who lets each child in: adults of its family, chosen by its administrator. */
export const kidGuardian = pgTable(
	'kid_guardian',
	{
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		kidId: text('kid_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		guardianId: text('guardian_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' })
	},
	(t) => [
		primaryKey({ columns: [t.kidId, t.guardianId] }),
		index('kid_guardian_guardian_idx').on(t.guardianId),
		familyRows('kid_guardian_own', t.familyId)
	]
).enableRLS();
