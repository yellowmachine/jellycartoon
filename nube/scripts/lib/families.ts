import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { user } from '../../src/lib/server/db/auth.schema.ts';
import { family, invitation } from '../../src/lib/server/db/family.schema.ts';

/**
 * A new family and the invitation of whoever will administer it, who then opens its link, signs up
 * with that email and chooses their password there. As the database's owner, whom row-level
 * security does not apply to: scripts/crear-familia.ts and scripts/migrate.ts. The link, to give
 * them: with ORIGIN, whole. Only the schema is in the image beside the scripts (Dockerfile): the
 * token made here as invitation-scope.ts's, and its 7 days the table's default.
 */
export async function createFamily(db: PostgresJsDatabase, name: string, email: string) {
	const familyId = randomUUID();
	const token = randomBytes(32).toString('base64url');
	await db.transaction(async (tx) => {
		await tx.insert(family).values({ id: familyId, name });
		await tx.insert(invitation).values({
			id: randomUUID(),
			email: email.trim(),
			token,
			familyId,
			role: 'admin'
		});
	});
	return `${process.env.ORIGIN ?? ''}/invitacion/${token}`;
}

/** Whether this email already has an account or an open invitation: then it is not invited again. */
export async function known(db: PostgresJsDatabase, email: string) {
	const address = email.trim().toLowerCase();
	const [found] = await db.execute<{ one: number }>(sql`
		select 1 as one from ${user} where lower(${user.email}) = ${address}
		union all
		select 1 from ${invitation} where lower(${invitation.email}) = ${address}
			and ${invitation.usedAt} is null and ${invitation.cancelledAt} is null
		limit 1
	`);
	return Boolean(found);
}
