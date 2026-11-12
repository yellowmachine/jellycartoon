import { and, eq, notInArray, sql } from 'drizzle-orm';
import { family } from './db/family.schema.ts';
import { storageQuota, storedFile } from './db/storage.schema.ts';
import { familyOnlyScope, type AnyDb } from './family-scope.ts';

/**
 * Each family's storage quota (#480): what its files take (`stored_file`, kept by storage.ts) and
 * how much it may keep, the default (STORAGE_QUOTA_MB) or its own, set in /admin. Apart from the
 * storage and the env, to be tried on PGlite. `role`: the tests' non-owner role.
 */

/** What the family does not upload, and Seilide can make again: not counted. */
export const UNCOUNTED_AREAS: ReadonlySet<string> = new Set(['frases-espera']);
/** From here, who runs the family is told. */
export const WARN_AT = 0.8;

export interface AreaUse {
	area: string;
	bytes: number;
	files: number;
}

export interface FamilyUse {
	used: number;
	limit: number;
	/** The counted areas, the biggest first. */
	areas: AreaUse[];
}

export interface Room {
	/** Counted before this file, without the one it replaces. */
	used: number;
	limit: number;
	fits: boolean;
	/** This file takes the family past WARN_AT. */
	crossesWarning: boolean;
}

export interface StoredObject {
	familyId: string;
	area: string;
	name: string;
	bytes: number;
}

const counted = notInArray(storedFile.area, [...UNCOUNTED_AREAS]);
const total = sql<number>`coalesce(sum(${storedFile.bytes}), 0)::bigint`.mapWith(Number);

export function fileQuotaScope(
	db: AnyDb,
	{ role, defaultBytes }: { role?: string; defaultBytes: number }
) {
	const asFamily = familyOnlyScope(db, { role });
	const asAdmin = <T>(fn: (tx: AnyDb) => Promise<T>): Promise<T> =>
		db.transaction(async (tx) => {
			if (role) await tx.execute(sql`select set_config('role', ${role}, true)`);
			await tx.execute(sql`select set_config('app.is_admin', 'true', true)`);
			return fn(tx as unknown as AnyDb);
		});

	const limitIn = async (tx: AnyDb, familyId: string) => {
		const [own] = await tx
			.select({ bytes: storageQuota.bytes })
			.from(storageQuota)
			.where(eq(storageQuota.familyId, familyId));
		return own?.bytes ?? defaultBytes;
	};

	return {
		/** Whether a file of `bytes` fits, `name` replacing the one already there if any. */
		room(familyId: string, area: string, name: string, bytes: number): Promise<Room> {
			return asFamily(familyId, async (tx) => {
				const limit = await limitIn(tx, familyId);
				const [row] = await tx
					.select({ used: total })
					.from(storedFile)
					.where(
						and(counted, sql`not (${storedFile.area} = ${area} and ${storedFile.name} = ${name})`)
					);
				const used = row?.used ?? 0;
				const after = used + bytes;
				return {
					used,
					limit,
					fits: UNCOUNTED_AREAS.has(area) || after <= limit,
					crossesWarning:
						!UNCOUNTED_AREAS.has(area) && used < limit * WARN_AT && after >= limit * WARN_AT
				};
			});
		},

		/** A file put (or put again). */
		kept(familyId: string, area: string, name: string, bytes: number) {
			return asFamily(familyId, (tx) =>
				tx
					.insert(storedFile)
					.values({ familyId, area, name, bytes })
					.onConflictDoUpdate({
						target: [storedFile.familyId, storedFile.area, storedFile.name],
						set: { bytes, createdAt: new Date() }
					})
			);
		},

		forgotten(familyId: string, area: string, name: string) {
			return asFamily(familyId, (tx) =>
				tx.delete(storedFile).where(and(eq(storedFile.area, area), eq(storedFile.name, name)))
			);
		},

		forgottenAll(familyId: string) {
			return asFamily(familyId, (tx) => tx.delete(storedFile));
		},

		/** How much a family takes and may take: Ajustes → Familia. */
		usage(familyId: string): Promise<FamilyUse> {
			return asFamily(familyId, async (tx) => {
				const limit = await limitIn(tx, familyId);
				const areas = await tx
					.select({ area: storedFile.area, bytes: total, files: sql<number>`count(*)::int` })
					.from(storedFile)
					.where(counted)
					.groupBy(storedFile.area)
					.orderBy(sql`2 desc`);
				return { used: areas.reduce((n, a) => n + a.bytes, 0), limit, areas };
			});
		},

		/** Every family, the fullest first: /admin. */
		families() {
			return asAdmin(async (tx) => {
				const used = tx
					.select({ familyId: storedFile.familyId, used: total.as('used') })
					.from(storedFile)
					.where(counted)
					.groupBy(storedFile.familyId)
					.as('used');
				const rows = await tx
					.select({
						familyId: family.id,
						name: family.name,
						used: sql<number>`coalesce(${used.used}, 0)`.mapWith(Number),
						own: storageQuota.bytes
					})
					.from(family)
					.leftJoin(used, eq(used.familyId, family.id))
					.leftJoin(storageQuota, eq(storageQuota.familyId, family.id));
				return rows
					.map((r) => ({
						familyId: r.familyId,
						name: r.name,
						used: r.used,
						limit: r.own ?? defaultBytes,
						custom: r.own !== null
					}))
					.sort((a, b) => b.used / b.limit - a.used / a.limit);
			});
		},

		/** A family's own quota; null, back to the default. */
		setLimit(familyId: string, bytes: number | null) {
			return asAdmin((tx) =>
				bytes === null
					? tx.delete(storageQuota).where(eq(storageQuota.familyId, familyId))
					: tx
							.insert(storageQuota)
							.values({ familyId, bytes })
							.onConflictDoUpdate({
								target: storageQuota.familyId,
								set: { bytes, updatedAt: new Date() }
							})
			);
		},

		/**
		 * The table set right against what is in the bucket: what is there and not here comes in (the
		 * files from before #480), what is here and not there goes. Families no longer here are skipped.
		 */
		async reconcile(objects: StoredObject[]) {
			const ids = new Set(
				await asAdmin(async (tx) =>
					(await tx.select({ id: family.id }).from(family)).map((f) => f.id)
				)
			);
			const byFamily = new Map<string, StoredObject[]>();
			for (const id of ids) byFamily.set(id, []);
			for (const o of objects) byFamily.get(o.familyId)?.push(o);
			let added = 0;
			let removed = 0;
			for (const [familyId, files] of byFamily)
				await asFamily(familyId, async (tx) => {
					const rows = await tx
						.select({ area: storedFile.area, name: storedFile.name, bytes: storedFile.bytes })
						.from(storedFile);
					const here = new Map(rows.map((r) => [`${r.area}/${r.name}`, r.bytes]));
					const there = new Set(files.map((f) => `${f.area}/${f.name}`));
					const missing = files.filter((f) => here.get(`${f.area}/${f.name}`) !== f.bytes);
					for (let i = 0; i < missing.length; i += 500)
						await tx
							.insert(storedFile)
							.values(missing.slice(i, i + 500))
							.onConflictDoUpdate({
								target: [storedFile.familyId, storedFile.area, storedFile.name],
								set: { bytes: sql`excluded.bytes` }
							});
					added += missing.length;
					for (const r of rows)
						if (!there.has(`${r.area}/${r.name}`)) {
							await tx
								.delete(storedFile)
								.where(and(eq(storedFile.area, r.area), eq(storedFile.name, r.name)));
							removed++;
						}
				});
			return { added, removed };
		}
	};
}

export type FileQuota = ReturnType<typeof fileQuotaScope>;
