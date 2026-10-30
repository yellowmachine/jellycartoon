import { count, countDistinct, desc, eq, gt, lt, sql } from 'drizzle-orm';
import { backupRun } from './db/backup.schema.ts';
import { family, house } from './db/family.schema.ts';
import { session, user } from './db/auth.schema.ts';
import { waitlist } from './db/waitlist.schema.ts';
import type { AnyDb } from './family-scope.ts';

/** Who has come in lately: a session used (Better Auth refreshes it once a day) in these days. */
export const ACTIVE_DAYS = 30;
/** A night's copy is late after this long without a good one: a day and a bit. */
export const BACKUP_LATE_HOURS = 26;
/** The runs shown of each app, and those kept: a week's. */
const RUNS_SHOWN = 7;
const RUNS_KEPT_DAYS = 30;

export interface BackupRun {
	ok: boolean;
	log: string;
	createdAt: Date;
}

export interface AppBackups {
	name: string;
	/** Its last good copy, if any. */
	lastOk: BackupRun | null;
	/** Its last runs, newest first. */
	runs: BackupRun[];
	/** Its last run failed, or no good one for BACKUP_LATE_HOURS. */
	alarm: boolean;
}

/**
 * The service's administrator's view (/admin), and the copies' reports (/api/admin/copias). The
 * families' tables are read in a transaction with `app.is_admin` (their `adminReads` policies,
 * family.schema.ts): counts of every family's, never written. `role`: the tests' non-owner role.
 */
export function adminScope(db: AnyDb, { role }: { role?: string } = {}) {
	const asAdmin = <T>(fn: (tx: AnyDb) => Promise<T>): Promise<T> =>
		db.transaction(async (tx) => {
			if (role) await tx.execute(sql`select set_config('role', ${role}, true)`);
			await tx.execute(sql`select set_config('app.is_admin', 'true', true)`);
			return fn(tx as unknown as AnyDb);
		});

	return {
		async counts() {
			const since = new Date(Date.now() - ACTIVE_DAYS * 24 * 60 * 60 * 1000);
			return asAdmin(async (tx) => {
				const [[families], [houses], [users], [active], [waiting]] = await Promise.all([
					tx.select({ n: count() }).from(family),
					tx.select({ n: count() }).from(house),
					tx.select({ n: count() }).from(user),
					tx
						.select({ n: countDistinct(session.userId) })
						.from(session)
						.where(gt(session.updatedAt, since)),
					tx.select({ n: count() }).from(waitlist).where(eq(waitlist.status, 'pending'))
				]);
				return {
					families: families.n,
					houses: houses.n,
					users: users.n,
					active: active.n,
					waiting: waiting.n
				};
			});
		},

		/** Each app that has reported, by name, with its last week's runs. */
		async backups(now = new Date()): Promise<AppBackups[]> {
			const rows = await db
				.select({
					name: backupRun.name,
					ok: backupRun.ok,
					log: backupRun.log,
					createdAt: backupRun.createdAt
				})
				.from(backupRun)
				.orderBy(backupRun.name, desc(backupRun.createdAt));
			const byName = new Map<string, BackupRun[]>();
			for (const { name, ...run } of rows) byName.set(name, [...(byName.get(name) ?? []), run]);
			const late = now.getTime() - BACKUP_LATE_HOURS * 60 * 60 * 1000;
			return [...byName].map(([name, runs]) => {
				const lastOk = runs.find((r) => r.ok) ?? null;
				return {
					name,
					lastOk,
					runs: runs.slice(0, RUNS_SHOWN),
					alarm: !runs[0].ok || !lastOk || lastOk.createdAt.getTime() < late
				};
			});
		},

		/** A copy's report; the ones of over a month ago, gone. */
		async recordBackup(run: { name: string; ok: boolean; log: string }) {
			await db.insert(backupRun).values(run);
			await db
				.delete(backupRun)
				.where(
					lt(backupRun.createdAt, new Date(Date.now() - RUNS_KEPT_DAYS * 24 * 60 * 60 * 1000))
				);
		}
	};
}
