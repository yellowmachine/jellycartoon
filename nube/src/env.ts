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
			"The road mode's map (#78): Spain's PMTiles and its style's fonts and icons, made with scripts/mapa.sh. Without it, the road mode goes without a map.",
		schema: (value) => value || '/data/mapa'
	},
	ROUTE_MAPS_DIR: {
		description:
			"Routes' maps cut for devices without coverage (#164), each family's in its folder: writable, unlike MAP_DIR.",
		schema: (value) => value || '/data/recorridos'
	},
	ADMIN_EMAIL: {
		description:
			"The service's administrator: the first family's (scripts/migrate.ts), and who is told by email of each family asking to come in (the landing page's «Pedir acceso»).",
		schema: (value) => value?.trim() || undefined
	},
	SMTP_HOST: {
		description:
			'The SMTP server the app sends its emails through (e.g. `smtp.protonmail.ch`). Without it, none is sent: only logged.',
		schema: (value) => value || undefined
	},
	SMTP_PORT: {
		description: 'Its port: 587 (STARTTLS) by default, 465 with SMTP_SECURE.',
		schema: (value) => Number(value || 587)
	},
	SMTP_SECURE: {
		description: '`true` for port 465 (SSL from the start); otherwise STARTTLS.',
		schema: (value) => value === 'true'
	},
	SMTP_USER: {
		description: 'The SMTP login, e.g. `no-reply@scholio.review`.',
		schema: (value) => value || undefined
	},
	SMTP_PASS: {
		description: "The SMTP password or token (Proton's SMTP token).",
		schema: (value) => value || undefined
	},
	EMAIL_FROM: {
		description: 'Who the emails come from, e.g. `Seilide <no-reply@scholio.review>`.',
		schema: (value) => value || 'Seilide <no-reply@scholio.review>'
	},
	BETTER_AUTH_SECRET: {
		description:
			"Secret used to sign tokens and to encrypt what the app keeps (the houses' keys). 32 characters generated with high entropy: `openssl rand -base64 32`."
	}
});
