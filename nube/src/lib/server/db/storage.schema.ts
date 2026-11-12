import { sql } from 'drizzle-orm';
import {
	bigint,
	integer,
	pgPolicy,
	pgTable,
	primaryKey,
	text,
	timestamp
} from 'drizzle-orm/pg-core';
import { adminReads, currentFamily, family, familyRows, serviceAdmin } from './family.schema.ts';

/**
 * Each family's files in the storage (storage.ts, #480): what each takes, to know how much a family
 * uses without listing the bucket, and to keep it under its quota. storage.ts keeps it as it puts
 * and removes files; at the server's start it is set right against the bucket (file-quota.ts).
 */
export const storedFile = pgTable(
	'stored_file',
	{
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		/** Its area in the storage: `fotos`, `papeles`, `ingresos`… */
		area: text('area').notNull(),
		name: text('name').notNull(),
		bytes: integer('bytes').notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.familyId, t.area, t.name] }),
		familyRows('stored_file_own', t.familyId),
		adminReads('stored_file_admin_reads')
	]
).enableRLS();

/**
 * A family's quota when it is not the default one (STORAGE_QUOTA_MB): set by the service's
 * administrator in /admin. The family reads it, never changes it.
 */
export const storageQuota = pgTable(
	'storage_quota',
	{
		familyId: text('family_id')
			.primaryKey()
			.references(() => family.id, { onDelete: 'cascade' }),
		bytes: bigint('bytes', { mode: 'number' }).notNull(),
		updatedAt: timestamp('updated_at').notNull().defaultNow()
	},
	(t) => [
		pgPolicy('storage_quota_family_reads', {
			for: 'select',
			using: sql`${t.familyId} = ${currentFamily}`
		}),
		pgPolicy('storage_quota_admin', { for: 'all', using: serviceAdmin, withCheck: serviceAdmin })
	]
).enableRLS();
