import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { plug } from '../db/plugs.schema.ts';
import type { AnyDb } from '../family-scope.ts';
import { hashOf } from '../house-key-scope.ts';

/**
 * The plugs' tokens (#396), as the satellites' keys (satellite-key-scope.ts): made, and recognised
 * by their SHA-256. The token goes in the address the plug connects to, so it is only letters,
 * digits, `-` and `_`. Apart from the app's database, to be tested on PGlite.
 */

/** What an address's last part must look like: base64url of 32 bytes. */
export const TOKEN_PATTERN = /^[\w-]{43}$/;

/** A new token: shown once, inside the address; kept only as its hash. */
export function newPlugToken() {
	const token = randomBytes(32).toString('base64url');
	return { token, hash: hashOf(token) };
}

export interface KeyPlug {
	id: string;
	familyId: string;
	name: string;
	energyWh: number | null;
}

/**
 * The plug of a token, or null: in one transaction Postgres is told the hash (`app.key_hash`),
 * which is all its policy lets it see.
 */
export function plugKeyScope(db: AnyDb, { role }: { role?: string } = {}) {
	return async function plugOfToken(token: string): Promise<KeyPlug | null> {
		if (!TOKEN_PATTERN.test(token)) return null;
		const hash = hashOf(token);
		return db.transaction(async (tx) => {
			if (role) await tx.execute(sql`select set_config('role', ${role}, true)`);
			await tx.execute(sql`select set_config('app.key_hash', ${hash}, true)`);
			const [found] = await tx
				.select({
					id: plug.id,
					familyId: plug.familyId,
					name: plug.name,
					energyWh: plug.energyWh
				})
				.from(plug)
				.where(eq(plug.hash, hash));
			return found ?? null;
		});
	};
}
