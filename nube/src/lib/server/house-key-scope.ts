import { createHash, randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { houseKey } from './db/family.schema.ts';
import type { AnyDb } from './family-scope.ts';

/**
 * The keys a family gives its house (family.schema.ts, `houseKey`): made, and recognised by their
 * SHA-256. Apart from the app's database, to be tested on PGlite as family-scope.ts.
 */

const PREFIX = 'nube_';

export const hashOf = (key: string) => createHash('sha256').update(key).digest('hex');

/** A new key: shown once, kept only as its hash. */
export function newHouseKey() {
	const key = `${PREFIX}${randomBytes(32).toString('base64url')}`;
	return { key, hash: hashOf(key), start: key.slice(0, PREFIX.length + 6) };
}

/**
 * The family of a key, or null: in one transaction Postgres is told the hash (`app.key_hash`),
 * which is all its policy lets it see; then the family, to note when it was last used.
 */
export function houseKeyScope(db: AnyDb, { role }: { role?: string } = {}) {
	return async function familyOfKey(key: string) {
		if (!key.startsWith(PREFIX)) return null;
		const hash = hashOf(key);
		return db.transaction(async (tx) => {
			if (role) await tx.execute(sql`select set_config('role', ${role}, true)`);
			await tx.execute(sql`select set_config('app.key_hash', ${hash}, true)`);
			const [found] = await tx
				.select({ id: houseKey.id, familyId: houseKey.familyId })
				.from(houseKey)
				.where(eq(houseKey.hash, hash));
			if (!found) return null;
			await tx.execute(sql`select set_config('app.family_id', ${found.familyId}, true)`);
			await tx.update(houseKey).set({ lastUsedAt: new Date() }).where(eq(houseKey.id, found.id));
			return found.familyId;
		});
	};
}
