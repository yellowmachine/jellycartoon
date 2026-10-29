import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

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
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [uniqueIndex('waitlist_email_idx').on(sql`lower(${t.email})`)]
);
