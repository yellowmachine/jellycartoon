import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { voiceSatellite } from './db/voice.schema.ts';
import type { AnyDb } from './family-scope.ts';
import { hashOf } from './house-key-scope.ts';

/**
 * The keys of the voice satellites Seilide serves (#296), as the house's (house-key-scope.ts):
 * made, and recognised by their SHA-256. Apart from the app's database, to be tested on PGlite.
 */

const PREFIX = 'satelite_';

/** A new key: shown once, kept only as its hash. */
export function newSatelliteKey() {
	const key = `${PREFIX}${randomBytes(32).toString('base64url')}`;
	return { key, hash: hashOf(key), start: key.slice(0, PREFIX.length + 6) };
}

export interface KeySatellite {
	id: string;
	familyId: string;
	name: string;
}

/**
 * The satellite of a key, or null: in one transaction Postgres is told the hash (`app.key_hash`),
 * which is all its policy lets it see; then its family, to note when it was last heard from.
 */
export function satelliteKeyScope(db: AnyDb, { role }: { role?: string } = {}) {
	return async function satelliteOfKey(key: string): Promise<KeySatellite | null> {
		if (!key.startsWith(PREFIX)) return null;
		const hash = hashOf(key);
		return db.transaction(async (tx) => {
			if (role) await tx.execute(sql`select set_config('role', ${role}, true)`);
			await tx.execute(sql`select set_config('app.key_hash', ${hash}, true)`);
			const [found] = await tx
				.select({
					id: voiceSatellite.id,
					familyId: voiceSatellite.familyId,
					name: voiceSatellite.name
				})
				.from(voiceSatellite)
				.where(eq(voiceSatellite.hash, hash));
			if (!found) return null;
			await tx.execute(sql`select set_config('app.family_id', ${found.familyId}, true)`);
			await tx
				.update(voiceSatellite)
				.set({ lastSeenAt: new Date() })
				.where(eq(voiceSatellite.id, found.id));
			return found;
		});
	};
}
