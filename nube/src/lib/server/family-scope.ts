import { eq, sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { familyMember } from './db/family.schema.ts';
import type * as schema from './db/schema.ts';

/** Any of Drizzle's Postgres drivers: postgres-js in the app, PGlite in the tests. */
export type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface Membership {
	familyId: string;
	role: 'admin' | 'member' | 'peque';
}

/**
 * The only way to a family's rows (family.schema.ts): one transaction in which Postgres knows who
 * asks (`app.user_id`) and their family (`app.family_id`), found by their own membership; the
 * policies show only that family's rows. `set_config(…, true)` is SET LOCAL: it ends with the
 * transaction, and the pool's next user starts with nothing. `role`: the tests' non-owner role,
 * which the app does not need (it already enters as one).
 */
export function familyScope(db: AnyDb, { role }: { role?: string } = {}) {
	return async function withFamily<T>(
		userId: string,
		fn: (tx: AnyDb, membership: Membership) => Promise<T>
	): Promise<T> {
		return db.transaction(async (tx) => {
			if (role) await tx.execute(sql`select set_config('role', ${role}, true)`);
			await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
			const [membership] = await tx
				.select({ familyId: familyMember.familyId, role: familyMember.role })
				.from(familyMember)
				.where(eq(familyMember.userId, userId));
			if (!membership) throw new NoFamily();
			await tx.execute(sql`select set_config('app.family_id', ${membership.familyId}, true)`);
			return fn(tx as unknown as AnyDb, membership);
		});
	};
}

/**
 * A family's rows without a person: for its house (the voice writing on its fridge, by its key),
 * once the key has said which family it is. The same policies, the family set directly.
 */
export function familyOnlyScope(db: AnyDb, { role }: { role?: string } = {}) {
	return async function asFamily<T>(familyId: string, fn: (tx: AnyDb) => Promise<T>): Promise<T> {
		return db.transaction(async (tx) => {
			if (role) await tx.execute(sql`select set_config('role', ${role}, true)`);
			await tx.execute(sql`select set_config('app.family_id', ${familyId}, true)`);
			return fn(tx as unknown as AnyDb);
		});
	};
}

/** Someone with an account and no family yet: let in by mistake, or theirs was removed. */
export class NoFamily extends Error {
	constructor() {
		super('Sin familia');
	}
}
