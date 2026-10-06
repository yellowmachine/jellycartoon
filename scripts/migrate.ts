/**
 * Applies pending migrations from ./drizzle. Runs before the app starts, both in development
 * (`bun run dev`) and in the container (see Dockerfile).
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const client = postgres(url, { max: 1, onnotice: () => {} });
try {
	await migrate(drizzle(client), { migrationsFolder: 'drizzle' });
	console.log('[migrate] base de datos al día');
} finally {
	await client.end();
}
