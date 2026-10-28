/**
 * Applies pending migrations from ./drizzle, as the database's owner (MIGRATE_DATABASE_URL): the
 * app's role (DATABASE_URL) cannot make tables. Runs before the app starts, in development
 * (`bun run dev`) and in the container (see Dockerfile).
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('MIGRATE_DATABASE_URL is not set');

const client = postgres(url, { max: 1, onnotice: () => {} });
try {
	await migrate(drizzle(client), { migrationsFolder: 'drizzle' });
	console.log('[migrate] base de datos al día');
} finally {
	await client.end();
}
