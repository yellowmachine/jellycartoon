import { boolean, index, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Each night's copy of the VPS's apps (deploy/vps-backup.sh, #320), as it reported when it ended,
 * well or not: for /admin. The service's, not a family's, so no row-level security, as `waitlist`.
 */
export const backupRun = pgTable(
	'backup_run',
	{
		id: serial('id').primaryKey(),
		/** The app: `seilide`, `langua`… (the first argument of vps-backup.sh). */
		name: text('name').notNull(),
		ok: boolean('ok').notNull(),
		/** The end of its output: what went up and how big, or what failed. */
		log: text('log').notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [index('backup_run_name_created_idx').on(t.name, t.createdAt)]
);
