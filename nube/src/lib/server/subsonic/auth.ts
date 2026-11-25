import { eq, sql } from 'drizzle-orm';
import { newAppPassword, passwordMatches } from 'comun/server/subsonic/protocol.ts';
import { user, userSecret } from '../db/schema.ts';
import { NoFamily, type AnyDb, type Membership } from '../family-scope.ts';

/**
 * Who a music app's request is from (#625): `u`, the account's email; the password, one only for
 * apps, kept among the person's secrets (user-secret.ts): the protocol has the app send
 * md5(password + salt), so it has to be read back, and a hash is of no use. The family's adults only.
 * Apart from the app's database, to be tested on PGlite.
 */
const SECRET = 'subsonic';

export interface AppUser {
	id: string;
	name: string;
	email: string;
	familyId: string;
}

export interface AuthDeps {
	db: AnyDb;
	withFamily: <T>(userId: string, fn: (tx: AnyDb, m: Membership) => Promise<T>) => Promise<T>;
	asUser: <T>(userId: string, fn: (tx: AnyDb) => Promise<T>) => Promise<T>;
	secrets: {
		get: (userId: string, name: string) => Promise<string | null>;
		set: (userId: string, name: string, text: string | null) => Promise<void>;
	};
}

export function appPasswords({ db, withFamily, asUser, secrets }: AuthDeps) {
	/** The person's family, if they may listen here: not a child's account, nor without family. */
	async function familyOf(userId: string) {
		try {
			return await withFamily(userId, async (_, m) => (m.role === 'peque' ? null : m.familyId));
		} catch (err) {
			if (err instanceof NoFamily) return null;
			throw err;
		}
	}

	return {
		familyOf,
		/** A new one, in place of the one before: shown once. Null: they may not have one. */
		async make(userId: string) {
			if (!(await familyOf(userId))) return null;
			const password = newAppPassword();
			await secrets.set(userId, SECRET, password);
			return password;
		},
		/** No app of theirs gets in from now on. */
		revoke: (userId: string) => secrets.set(userId, SECRET, null),
		/** When theirs was made; null without one. */
		async since(userId: string) {
			const [row] = await asUser(userId, (tx) =>
				tx
					.select({ at: userSecret.updatedAt })
					.from(userSecret)
					.where(sql`${userSecret.userId} = ${userId} and ${userSecret.name} = ${SECRET}`)
			);
			return row?.at ?? null;
		},
		async userOf(params: URLSearchParams): Promise<AppUser | null> {
			const email = params.get('u')?.trim().toLowerCase();
			if (!email) return null;
			const [row] = await db
				.select({ id: user.id, name: user.name, email: user.email })
				.from(user)
				.where(eq(sql`lower(${user.email})`, email));
			if (!row) return null;
			const familyId = await familyOf(row.id);
			if (!familyId) return null;
			const password = await secrets.get(row.id, SECRET);
			if (!password) return null;
			const sent = { t: params.get('t'), s: params.get('s'), p: params.get('p') };
			return passwordMatches(password, sent) ? { ...row, familyId } : null;
		}
	};
}
