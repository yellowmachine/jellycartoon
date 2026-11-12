import { and, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { familyStorage } from './db/storage.schema.ts';
import { familyOnlyScope, type AnyDb } from './family-scope.ts';

/**
 * Where each family's files are (#480, phase 2): Seilide's storage (no row) or its own, and the move
 * between them. Only the rows: the buckets come sealed (family-secret.ts) and the copy is
 * storage-move.ts'. `role`: the tests' non-owner role.
 */

export type StorageRow = typeof familyStorage.$inferSelect;

/** Where it is going: its own bucket, sealed, and what it says; null, Seilide's. */
export type Destination = { sealed: string; label: string } | null;

/** A week of its copies in Seilide's storage after moving out, in case. */
export const KEEP_COPIES_DAYS = 7;

export function familyStorageScope(db: AnyDb, { role }: { role?: string } = {}) {
	const asFamily = familyOnlyScope(db, { role });
	const asAdmin = <T>(fn: (tx: AnyDb) => Promise<T>): Promise<T> =>
		db.transaction(async (tx) => {
			if (role) await tx.execute(sql`select set_config('role', ${role}, true)`);
			await tx.execute(sql`select set_config('app.is_admin', 'true', true)`);
			return fn(tx as unknown as AnyDb);
		});
	const rowIn = async (tx: AnyDb) => (await tx.select().from(familyStorage))[0] ?? null;

	return {
		/** Its row; null, all in Seilide's storage. */
		of(familyId: string) {
			return asFamily(familyId, rowIn);
		},

		/**
		 * A move begins: to its own bucket, or (null) back to Seilide's, the administrator's way out.
		 * False if one is already going.
		 */
		start(familyId: string, to: Destination, total: number) {
			return asFamily(familyId, async (tx) => {
				const row = await rowIn(tx);
				if (row?.moving) return false;
				const set = {
					moving: true,
					next: to?.sealed ?? null,
					nextLabel: to?.label ?? null,
					done: 0,
					total,
					problem: null,
					updatedAt: new Date()
				};
				await tx
					.insert(familyStorage)
					.values({ familyId, ...set })
					.onConflictDoUpdate({ target: familyStorage.familyId, set });
				return true;
			});
		},

		progress(familyId: string, done: number, total?: number) {
			return asFamily(familyId, (tx) =>
				tx
					.update(familyStorage)
					.set({ done, ...(total === undefined ? {} : { total }), updatedAt: new Date() })
					.where(eq(familyStorage.moving, true))
			);
		},

		/** Stopped, with why: fixed, it goes on from where it was. */
		stopped(familyId: string, problem: string) {
			return asFamily(familyId, (tx) =>
				tx
					.update(familyStorage)
					.set({ problem, updatedAt: new Date() })
					.where(eq(familyStorage.moving, true))
			);
		},

		/** Going on after a problem: its keys may be new (`to`, the same place). */
		resume(familyId: string, to?: Destination) {
			return asFamily(familyId, (tx) =>
				tx
					.update(familyStorage)
					.set({
						problem: null,
						...(to ? { next: to.sealed, nextLabel: to.label } : {}),
						updatedAt: new Date()
					})
					.where(eq(familyStorage.moving, true))
			);
		},

		/**
		 * All copied: where they went is where they are. Out of Seilide's storage, its copies there go
		 * in a week; back to it, the row goes (as any family's that never left).
		 */
		finish(familyId: string, now = new Date()) {
			return asFamily(familyId, async (tx) => {
				const row = await rowIn(tx);
				if (!row?.moving) return;
				if (!row.next) {
					await tx.delete(familyStorage);
					return;
				}
				await tx.update(familyStorage).set({
					current: row.next,
					currentLabel: row.nextLabel,
					moving: false,
					next: null,
					nextLabel: null,
					problem: null,
					movedAt: now,
					cleanupAt: row.current
						? row.cleanupAt
						: new Date(now.getTime() + KEEP_COPIES_DAYS * 24 * 60 * 60 * 1000),
					updatedAt: now
				});
			});
		},

		/** Not moving any more: where they were, they stay. Never from Seilide's: a row with nothing goes. */
		cancel(familyId: string) {
			return asFamily(familyId, async (tx) => {
				const row = await rowIn(tx);
				if (!row?.moving) return;
				if (!row.current && !row.cleanupAt) await tx.delete(familyStorage);
				else
					await tx.update(familyStorage).set({
						moving: false,
						next: null,
						nextLabel: null,
						problem: null,
						updatedAt: new Date()
					});
			});
		},

		/** New keys for the same bucket: nothing moves. */
		setKeys(familyId: string, sealed: string, label: string) {
			return asFamily(familyId, (tx) =>
				tx
					.update(familyStorage)
					.set({ current: sealed, currentLabel: label, updatedAt: new Date() })
					.where(isNotNull(familyStorage.current))
			);
		},

		/** Every family not only in Seilide's storage: the start's count skips them. */
		async notInSeilide() {
			const rows = await asAdmin((tx) =>
				tx.select({ familyId: familyStorage.familyId }).from(familyStorage)
			);
			return new Set(rows.map((r) => r.familyId));
		},

		/** The moves to go on with after a restart: not stopped by a problem. */
		async pendingMoves() {
			const rows = await asAdmin((tx) =>
				tx
					.select({ familyId: familyStorage.familyId, problem: familyStorage.problem })
					.from(familyStorage)
					.where(eq(familyStorage.moving, true))
			);
			return rows.filter((r) => !r.problem).map((r) => r.familyId);
		},

		/** Whose copies in Seilide's storage are due to go. */
		async cleanupDue(now = new Date()) {
			const rows = await asAdmin((tx) =>
				tx
					.select({ familyId: familyStorage.familyId })
					.from(familyStorage)
					.where(
						and(
							isNotNull(familyStorage.cleanupAt),
							lte(familyStorage.cleanupAt, now),
							eq(familyStorage.moving, false)
						)
					)
			);
			return rows.map((r) => r.familyId);
		},

		cleaned(familyId: string) {
			return asFamily(familyId, (tx) =>
				tx.update(familyStorage).set({ cleanupAt: null, updatedAt: new Date() })
			);
		},

		/** Each family's, for /admin. */
		all() {
			return asAdmin((tx) => tx.select().from(familyStorage));
		}
	};
}

export type FamilyStorage = ReturnType<typeof familyStorageScope>;
