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
	MUSIC_DIR: {
		description:
			'Optional read-only directory with music, one folder per album or disc: ripped from CDs (FLAC) or Opus (e.g. from yt-dlp), with album tags. Without it there is no Música section.',
		schema: (value) => value || undefined
	},
	MUSIC_MPV_SOCKET: {
		description:
			'IPC socket of an mpv that plays music into Snapcast (its output is the FIFO of a snapserver `pipe` source). With it, albums can be sent to Snapcast from the Música page.',
		schema: (value) => value || undefined
	},
	SNAPSERVER_CONTROL: {
		description:
			"`host:port` of snapserver's JSON-RPC control over TCP (port 1705). With it, the Snapcast bar lists its clients and sets their volume and name.",
		schema: (value) => value || undefined
	},
	MPV_SOCKET: {
		description:
			'IPC socket of an mpv left waiting on the host (`mpv --idle --input-ipc-server=…`). With it, films can be played on that screen from the Cine page and their progress is saved.',
		schema: (value) => value || undefined
	},
	OPENROUTER_API_KEY: {
		description:
			'Optional OpenRouter key, used to identify films and to talk about them. It can also be set in Ajustes; this one takes precedence.',
		schema: (value) => value || undefined
	},
	OPENROUTER_MODEL: {
		description:
			'Optional OpenRouter model id (e.g. `anthropic/claude-haiku-5.5`), unless set in Ajustes.',
		schema: (value) => value || undefined
	},
	OPENROUTESERVICE_API_KEY: {
		description:
			"Optional openrouteservice key, for the road mode's routes (#78). It can also be set in Ajustes; this one takes precedence.",
		schema: (value) => value || undefined
	},
	WHISPER_URL: {
		description:
			'Optional address of a whisper.cpp server (`whisper-server`, started with `--convert`), for voice commands: it turns what is said into text. Without it there is no voice.',
		schema: (value) => value || undefined
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
	},
	APP_VERSION: {
		description:
			'The version this build is: `1.2.0` in the images of a release, `sha-…` in the others. Set by the image, not by hand.',
		schema: withDefault('dev')
	},
	WUD_URL: {
		description:
			"Optional address of WUD (What's Up Docker), which updates the app: with it, the admin can update from the notice of a new version.",
		schema: (value) => value || undefined
	},
	WUD_PASSWORD: {
		description: "Password of WUD's `admin` user, for its API.",
		schema: (value) => value || undefined
	}
});
