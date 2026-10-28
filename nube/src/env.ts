import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	DATABASE_URL: {
		description:
			"The database as the app's role (`nube_app`, scripts/init-db.sh): not its owner, so that Postgres' row-level security applies to it."
	},
	MIGRATE_DATABASE_URL: {
		description:
			"The database as its owner, who makes the tables: only for the migrations (scripts/migrate.ts). Without it, DATABASE_URL's.",
		schema: (value) => value || undefined
	},
	ORIGIN: {
		description: 'The app origin (base URL), e.g. `https://nube.example.com`.'
	},
	BETTER_AUTH_SECRET: {
		description:
			"Secret used to sign tokens and to encrypt what the app keeps (the houses' keys). 32 characters generated with high entropy: `openssl rand -base64 32`."
	}
});
