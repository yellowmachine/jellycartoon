import { eq, inArray } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { account, session, user } from './db/schema.ts';
import type * as schema from './db/schema.ts';

/**
 * The sessions of whoever entered with Seilide and is not among these adults (#315): the rule
 * alone, on the database, to test it (nube-members.ts asks Seilide). By email, as the house and the
 * cloud know each other's people. A family always has someone: a list without anyone, or something
 * that is not a list, is not one to act on.
 */
export async function closeSessionsOfThoseNotIn(
	db: PgDatabase<PgQueryResultHKT, typeof schema>,
	adults: unknown,
	{ provider, isAdmin }: { provider: string; isAdmin: (userId: string) => Promise<boolean> }
) {
	if (!Array.isArray(adults) || !adults.length) return 0;
	const here = new Set(adults.map((email) => String(email).trim().toLowerCase()));
	const withCloud = await db
		.select({ id: user.id, email: user.email })
		.from(account)
		.innerJoin(user, eq(user.id, account.userId))
		.where(eq(account.providerId, provider));
	const gone: string[] = [];
	for (const person of withCloud)
		if (!here.has(person.email.trim().toLowerCase()) && !(await isAdmin(person.id)))
			gone.push(person.id);
	if (!gone.length) return 0;
	const closed = await db
		.delete(session)
		.where(inArray(session.userId, gone))
		.returning({ id: session.id });
	return closed.length;
}
