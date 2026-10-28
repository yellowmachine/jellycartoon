/**
 * A new family, by the service's administrator (#253): the family, and an invitation for the email
 * of whoever will administer it, who then signs up with that email («Tengo una invitación») and is
 * in. As the database's owner (MIGRATE_DATABASE_URL), whom row-level security does not apply to.
 *
 *   bun run familia "Casa García" ana@example.com
 */
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { family, invitation } from '../src/lib/server/db/family.schema.ts';

const [name, email] = process.argv.slice(2);
if (!name || !email?.includes('@')) {
	console.error('Uso: bun run familia "<nombre de la familia>" <email de quien la administra>');
	process.exit(1);
}

const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('MIGRATE_DATABASE_URL is not set');

const client = postgres(url, { max: 1, onnotice: () => {} });
try {
	const db = drizzle(client);
	const familyId = randomUUID();
	await db.transaction(async (tx) => {
		await tx.insert(family).values({ id: familyId, name });
		await tx
			.insert(invitation)
			.values({ id: randomUUID(), email: email.trim(), familyId, role: 'admin' });
	});
	console.log(
		`Familia «${name}» creada. ${email} ya puede crear su cuenta con «Tengo una invitación».`
	);
} finally {
	await client.end();
}
