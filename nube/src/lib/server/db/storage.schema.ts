import { sql } from 'drizzle-orm';
import {
	bigint,
	boolean,
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

/**
 * A family's own storage (#480, phase 2): its S3/R2, kept sealed with its key (family-secret.ts).
 * No row, Seilide's. Once on its own it never goes back by itself (only the service's administrator,
 * in /admin); to another of its own, yes. While `moving`, its files are copied to `next` (null:
 * back to Seilide's, the administrator's way out), written in both and read from `current` first.
 */
export const familyStorage = pgTable(
	'family_storage',
	{
		familyId: text('family_id')
			.primaryKey()
			.references(() => family.id, { onDelete: 'cascade' }),
		/** Where its files are, sealed (storage-place.ts' `Bucket`); null, Seilide's. */
		current: text('current'),
		/** What it says, without its keys: «r2.cloudflarestorage.com · fotos · seilide/». */
		currentLabel: text('current_label'),
		moving: boolean('moving').notNull().default(false),
		/** Where they are going while `moving`, sealed; null, to Seilide's. */
		next: text('next'),
		nextLabel: text('next_label'),
		/** How far: files copied of all. */
		done: integer('done').notNull().default(0),
		total: integer('total').notNull().default(0),
		/** Why it stopped, to say in Ajustes: fixed, «Seguir». */
		problem: text('problem'),
		movedAt: timestamp('moved_at'),
		/** When its copies in Seilide's storage go, a week after moving out of it. */
		cleanupAt: timestamp('cleanup_at'),
		updatedAt: timestamp('updated_at').notNull().defaultNow()
	},
	(t) => [familyRows('family_storage_own', t.familyId), adminReads('family_storage_admin_reads')]
).enableRLS();
