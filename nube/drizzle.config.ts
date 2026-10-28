import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'postgresql',
	// As the owner (MIGRATE_DATABASE_URL), who makes the tables; the app's role cannot.
	dbCredentials: { url: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL },
	verbose: true,
	strict: true
});
