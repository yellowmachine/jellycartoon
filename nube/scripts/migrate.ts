/**
 * Applies pending migrations from ./drizzle, as the database's owner (MIGRATE_DATABASE_URL): the
 * app's role (DATABASE_URL) cannot make tables. Runs before the app starts, in development
 * (`bun run dev`) and in the container (see Dockerfile).
 *
 * Then, with ADMIN_EMAIL, the first family (ADMIN_FAMILY, «Mi casa» without it) and that email's
 * invitation as its administrator, if it has neither an account nor an invitation yet: a new
 * install needs no command. Never a password from the environment: it is chosen on signing up, and
 * a deploy does not put an old one back.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { createFamily, known } from './lib/families.ts';

const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('MIGRATE_DATABASE_URL is not set');

const client = postgres(url, { max: 1, onnotice: () => {} });
try {
	const db = drizzle(client);
	await migrate(db, { migrationsFolder: 'drizzle' });
	console.log('[migrate] base de datos al día');
	const email = process.env.ADMIN_EMAIL?.trim();
	if (email && !(await known(db, email))) {
		const name = process.env.ADMIN_FAMILY?.trim() || 'Mi casa';
		await createFamily(db, name, email);
		console.log(`[migrate] familia «${name}» creada: ${email} entra con «Tengo una invitación»`);
	}
} finally {
	await client.end();
}
