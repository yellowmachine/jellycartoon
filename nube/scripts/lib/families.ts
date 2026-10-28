import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { user } from '../../src/lib/server/db/auth.schema.ts';
import { family, invitation } from '../../src/lib/server/db/family.schema.ts';

/**
 * A new family and the invitation of whoever will administer it, who then signs up with that
 * email («Tengo una invitación») and chooses their password there. As the database's owner, whom
 * row-level security does not apply to: scripts/crear-familia.ts and scripts/migrate.ts.
 */
export async function createFamily(db: PostgresJsDatabase, name: string, email: string) {
	const familyId = randomUUID();
	await db.transaction(async (tx) => {
		await tx.insert(family).values({ id: familyId, name });
		await tx
			.insert(invitation)
			.values({ id: randomUUID(), email: email.trim(), familyId, role: 'admin' });
	});
}

/** Whether this email already has an account or an invitation: then it is not invited again. */
export async function known(db: PostgresJsDatabase, email: string) {
	const address = email.trim().toLowerCase();
	const [found] = await db.execute<{ one: number }>(sql`
		select 1 as one from ${user} where lower(${user.email}) = ${address}
		union all
		select 1 from ${invitation} where lower(${invitation.email}) = ${address}
		limit 1
	`);
	return Boolean(found);
}
