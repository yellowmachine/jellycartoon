import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { locationPoint, owntracksLink } from '../db/owntracks.schema.ts';
import { userScope, type AnyDb } from '../family-scope.ts';
import { hashOf } from '../house-key-scope.ts';
import type { OwntracksPoint } from '#lib/owntracks.ts';

/**
 * OwnTracks (#593) on the database: a person's connection and their positions, theirs only
 * (`asUser`). Whose a password is, found by its hash alone, as the bank's calls (bank-key-scope.ts).
 * Apart from the app's database, to be tested on PGlite.
 */

/** base64url of 32 random bytes. */
export const PASSWORD = /^[\w-]{43}$/;

export function owntracksScope(db: AnyDb, { role }: { role?: string } = {}) {
	const asUser = userScope(db, { role });

	/** The person of a password, or null: Postgres is told only its hash (`app.key_hash`). */
	async function userOf(password: string | null): Promise<string | null> {
		if (!password || !PASSWORD.test(password)) return null;
		const hash = hashOf(password);
		return db.transaction(async (tx) => {
			if (role) await tx.execute(sql`select set_config('role', ${role}, true)`);
			await tx.execute(sql`select set_config('app.key_hash', ${hash}, true)`);
			const [found] = await tx
				.select({ userId: owntracksLink.userId })
				.from(owntracksLink)
				.where(eq(owntracksLink.tokenHash, hash));
			return found?.userId ?? null;
		});
	}

	/** A new password, replacing theirs: shown once, kept only as its hash. */
	function connect(userId: string) {
		const password = randomBytes(32).toString('base64url');
		const tokenHash = hashOf(password);
		return asUser(userId, async (tx) => {
			await tx
				.insert(owntracksLink)
				.values({ userId, tokenHash })
				.onConflictDoUpdate({
					target: owntracksLink.userId,
					set: { tokenHash, createdAt: new Date() }
				});
			return password;
		});
	}

	/** Their password forgotten: their OwnTracks gets 401 from now on. Their positions stay. */
	function disconnect(userId: string) {
		return asUser(userId, (tx) => tx.delete(owntracksLink).where(eq(owntracksLink.userId, userId)));
	}

	/** All their positions, gone. */
	function forget(userId: string) {
		return asUser(userId, (tx) => tx.delete(locationPoint).where(eq(locationPoint.userId, userId)));
	}

	/** One position; the same moment again (sent twice), kept once. */
	function save(userId: string, p: OwntracksPoint) {
		return asUser(userId, (tx) =>
			tx
				.insert(locationPoint)
				.values({ userId, ...p })
				.onConflictDoNothing()
		);
	}

	/** Whether they are connected and since when, and their last position as it came. */
	function status(userId: string) {
		return asUser(userId, async (tx) => {
			const [link] = await tx
				.select({ createdAt: owntracksLink.createdAt })
				.from(owntracksLink)
				.where(eq(owntracksLink.userId, userId));
			const [last] = await tx
				.select({
					at: locationPoint.at,
					receivedAt: locationPoint.receivedAt,
					battery: locationPoint.battery,
					device: locationPoint.device
				})
				.from(locationPoint)
				.where(eq(locationPoint.userId, userId))
				.orderBy(desc(locationPoint.at))
				.limit(1);
			return { connectedAt: link?.createdAt ?? null, last: last ?? null };
		});
	}

	/** Their positions between two moments, in order: a day's way. */
	function between(userId: string, from: Date, to: Date) {
		return asUser(userId, (tx) =>
			tx
				.select({
					at: locationPoint.at,
					lon: locationPoint.lon,
					lat: locationPoint.lat,
					accuracy: locationPoint.accuracy,
					speed: locationPoint.speed
				})
				.from(locationPoint)
				.where(
					and(
						eq(locationPoint.userId, userId),
						gte(locationPoint.at, from),
						lt(locationPoint.at, to)
					)
				)
				.orderBy(asc(locationPoint.at))
		);
	}

	return { userOf, connect, disconnect, forget, save, status, between };
}
