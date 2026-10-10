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
	HOST_DATA_DIR: {
		description:
			'Absolute path of DATA_DIR on the host when running in a container. Lets the app show where each converted episode is, to open it with a native player (mpv…). Ignored if relative: it would depend on where compose ran.',
		schema: (value) => (value?.startsWith('/') ? value : undefined)
	},
	CINEMA_DIR: {
		description:
			'Optional read-only directory with films (big .mkv files). They are only catalogued, never converted: played with mpv on the host. Without it there is no Cine section.',
		schema: (value) => value || undefined
	},
	HOST_CINEMA_DIR: {
		description:
			'Absolute path of CINEMA_DIR on the host, which is what mpv on the host needs. Ignored if relative, like HOST_DATA_DIR.',
		schema: (value) => (value?.startsWith('/') ? value : undefined)
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
	DELETE_SOURCES: {
		description:
			'Set to `true` to delete originals (and their subtitle files) from MEDIA_DIR once converted.',
		schema: (value) => value === 'true'
	},
	ALLOW_SIGNUP: {
		description: 'Set to `false` to disable creating new accounts.',
		schema: (value) => value !== 'false'
	}
});
