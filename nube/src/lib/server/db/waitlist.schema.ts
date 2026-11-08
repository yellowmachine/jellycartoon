import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { user } from './auth.schema.ts';

/**
 * Families that asked to come in from the landing page («Pedir acceso»), as svelte-thinking's
 * «unirse a la beta»: the service's administrator (ADMIN_EMAIL) lets them in. Nobody's family yet,
 * so no row-level security, as `invitation`.
 */
export const waitlist = pgTable(
	'waitlist',
	{
		id: text('id').primaryKey(),
		email: text('email').notNull(),
		name: text('name').notNull(),
		/** What they would use it for, if they said. */
		message: text('message'),
		status: text('status', { enum: ['pending', 'approved', 'rejected'] })
			.notNull()
			.default('pending'),
		/** Where they came from, if from somewhere: today only a walk shared by link (#434). */
		origin: text('origin', { enum: ['walk_share'] }),
		/** Who shared it; gone with their account. */
		referredBy: text('referred_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [uniqueIndex('waitlist_email_idx').on(sql`lower(${t.email})`)]
);
