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
	S3_ENDPOINT: {
		description:
			"The S3 storage of the families' files (receipts' photos, bills): the stack's own rustfs, `http://rustfs:9000` (compose.prod.yaml).",
		schema: (value) => value || undefined
	},
	S3_BUCKET: {
		description: 'Its bucket, made by the app if it is not there.',
		schema: (value) => value || 'nube'
	},
	S3_ACCESS_KEY_ID: {
		description: "The S3 storage's access key (rustfs' user, in compose.prod.yaml).",
		schema: (value) => value || undefined
	},
	S3_SECRET_ACCESS_KEY: {
		description: "The S3 storage's secret key.",
		schema: (value) => value || undefined
	},
	MAP_DIR: {
		description:
			"The road mode's map (#78): Spain's PMTiles and its style's fonts and icons, made with jellycartoon's scripts/mapa.sh. Without it, the road mode goes without a map.",
		schema: (value) => value || '/data/mapa'
	},
	BETTER_AUTH_SECRET: {
		description:
			"Secret used to sign tokens and to encrypt what the app keeps (the houses' keys). 32 characters generated with high entropy: `openssl rand -base64 32`."
	}
});
