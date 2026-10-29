/**
 * A new family, by the service's administrator (#253): the family, and an invitation for the email
 * of whoever will administer it, who then opens its link (printed here), signs up with that email
 * and is in. As the database's owner (MIGRATE_DATABASE_URL), whom row-level security does not apply to.
 *
 *   bun run familia "Casa García" ana@example.com
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { createFamily, known } from './lib/families.ts';

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
	if (await known(db, email)) {
		console.error(`${email} ya tiene cuenta o invitación`);
		process.exit(1);
	}
	const link = await createFamily(db, name, email);
	console.log(`Familia «${name}» creada. ${email} crea su cuenta en ${link} (caduca en 7 días).`);
} finally {
	await client.end();
}
