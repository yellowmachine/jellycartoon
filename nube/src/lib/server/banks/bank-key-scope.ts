import { eq, sql } from 'drizzle-orm';
import { bankLink } from '../db/banks.schema.ts';
import type { AnyDb } from '../family-scope.ts';
import { hashOf } from '../house-key-scope.ts';

/**
 * Whose bank calls (#502): the token in the address bunq calls, recognised by its SHA-256, as the
 * plugs' (plug-key-scope.ts). Apart from the app's database, to be tested on PGlite.
 */

/** What an address's last part must look like: base64url of 32 bytes. */
export const HOOK_TOKEN = /^[\w-]{43}$/;

/** The person of a token, or null: Postgres is told only the hash (`app.key_hash`). */
export function bankKeyScope(db: AnyDb, { role }: { role?: string } = {}) {
	return async function userOfHook(token: string): Promise<string | null> {
		if (!HOOK_TOKEN.test(token)) return null;
		const hash = hashOf(token);
		return db.transaction(async (tx) => {
			if (role) await tx.execute(sql`select set_config('role', ${role}, true)`);
			await tx.execute(sql`select set_config('app.key_hash', ${hash}, true)`);
			const [found] = await tx
				.select({ userId: bankLink.userId })
				.from(bankLink)
				.where(eq(bankLink.hookHash, hash));
			return found?.userId ?? null;
		});
	};
}
