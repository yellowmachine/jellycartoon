import { defineEnvVars } from '@sveltejs/kit/env';

const withDefault = (fallback: string) => (value: string | undefined) => value || fallback;

export const variables = defineEnvVars({
	DATABASE_URL: { description: 'The database connection string.' },
	ORIGIN: {
		description: 'The app origin (base URL), e.g. `http://192.168.1.10:3000`.'
	},
	BETTER_AUTH_SECRET: {
		description:
			'Secret used to sign tokens. For production use 32 characters generated with high entropy. See [Better Auth installation](https://www.better-auth.com/docs/installation).'
	},
	MEDIA_DIR: {
		description: 'Read-only directory with the original videos, one folder per series.',
		schema: withDefault('./media')
	},
	DATA_DIR: {
		description: 'Writable directory for transcoded videos and thumbnails.',
		schema: withDefault('./data')
	},
	AUDIO_LANG: {
		description:
			'Preferred audio language (ISO 639-2, e.g. `spa`) when a source has several audio tracks.',
		schema: withDefault('spa')
	},
	X264_PRESET: {
		description: 'x264 preset used when transcoding (`veryfast`…`slow`).',
		schema: withDefault('medium')
	},
	X264_CRF: {
		description: 'x264 quality (lower is better and bigger). 20 is a good default for SD sources.',
		schema: withDefault('20')
	},
	ALLOW_SIGNUP: {
		description: 'Set to `false` to disable creating new accounts.',
		schema: (value) => value !== 'false'
	}
});
