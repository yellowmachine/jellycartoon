import {
	bigint,
	boolean,
	check,
	date,
	doublePrecision,
	index,
	jsonb,
	integer,
	pgEnum,
	pgTable,
	primaryKey,
	real,
	serial,
	text,
	timestamp,
	unique
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { AudioTrack, SubtitleTrack } from '#lib/languages.ts';
import type { Chapter, SceneName } from '#lib/scenes.ts';
import type { SubtitleStyle } from '#lib/subtitle-style.ts';
import type { WikiPage } from '#lib/server/cinema/wikidata.ts';
import type { TitleProposal } from '#lib/episode-titles.ts';
import type { RecipeStep } from '#lib/recipe.ts';
import type { LngLat } from '#lib/road.ts';
import type { RouteStop } from '#lib/saved-places.ts';
import type { Exercise, HomeworkRules, Step } from '#lib/homework.ts';
import { session, user } from './auth.schema';

export const series = pgTable('series', {
	id: serial('id').primaryKey(),
	/** Folder name inside MEDIA_DIR. */
	folder: text('folder').notNull().unique(),
	title: text('title').notNull(),
	/** Episodes follow a story: playlists pick the next unwatched one instead of a random one. */
	serialized: boolean('serialized').notNull().default(true),
	/** Position in the conversion queue, set by dragging in Gestión; null goes last. */
	queueOrder: integer('queue_order'),
	/**
	 * ISO 639-2 of its audio when the files do not say (`und`): assumed for those tracks, also for
	 * episodes converted later. Null: unknown.
	 */
	audioLang: text('audio_lang'),
	createdAt: timestamp('created_at').notNull().defaultNow()
});

/** Labels for series and films, shared by every user: e.g. «infantil», what a child's account sees. */
export const tag = pgTable('tag', {
	id: serial('id').primaryKey(),
	/** Lowercase: «Infantil» and «infantil» are the same tag. */
	name: text('name').notNull().unique()
});

export const seriesTag = pgTable(
	'series_tag',
	{
		seriesId: integer('series_id')
			.notNull()
			.references(() => series.id, { onDelete: 'cascade' }),
		tagId: integer('tag_id')
			.notNull()
			.references(() => tag.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.seriesId, t.tagId] }), index('series_tag_tag_idx').on(t.tagId)]
);

/** `ignored`: failed and set aside by hand; not retried until its file changes. */
export const episodeStatus = pgEnum('episode_status', [
	'pending',
	'processing',
	'ready',
	'error',
	'ignored'
]);

export const episode = pgTable(
	'episode',
	{
		id: serial('id').primaryKey(),
		seriesId: integer('series_id')
			.notNull()
			.references(() => series.id, { onDelete: 'cascade' }),
		season: integer('season').notNull(),
		number: integer('number').notNull(),
		/** Derived from the file name on every scan. */
		title: text('title').notNull(),
		/** Set by hand; shown instead of `title` and kept across scans. */
		customTitle: text('custom_title'),
		/** Proposed by the AI and accepted in the series page; `customTitle` still wins over it. */
		aiTitle: text('ai_title'),
		/** Season and number were set by hand: scans no longer derive them from the path. */
		manualNumbering: boolean('manual_numbering').notNull().default(false),
		/** Path relative to MEDIA_DIR. */
		sourcePath: text('source_path').notNull().unique(),
		sourceSize: bigint('source_size', { mode: 'number' }).notNull(),
		sourceMtime: timestamp('source_mtime').notNull(),
		/** Set when the source is missing from the last scan. */
		missing: boolean('missing').notNull().default(false),
		/** The original was deleted on purpose after converting (DELETE_SOURCES); not "missing". */
		sourceRemoved: boolean('source_removed').notNull().default(false),
		status: episodeStatus('status').notNull().default('pending'),
		/** Higher goes first in the conversion queue; 0 keeps series/season/number order. */
		priority: integer('priority').notNull().default(0),
		/** 0..1 while processing. */
		progress: real('progress').notNull().default(0),
		error: text('error'),
		/** Probed when scanned, so the queue can be estimated before converting. */
		durationSec: real('duration_sec'),
		/** Seconds the conversion took, not counting pauses. */
		convertSec: real('convert_sec'),
		outputSize: bigint('output_size', { mode: 'number' }),
		/** In the same order as the HLS master playlist. */
		audioTracks: jsonb('audio_tracks').$type<AudioTrack[]>().notNull().default([]),
		/** WebVTT files inside the episode's HLS folder. */
		subtitles: jsonb('subtitles').$type<SubtitleTrack[]>().notNull().default([]),
		updatedAt: timestamp('updated_at')
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date())
	},
	(t) => [
		index('episode_series_idx').on(t.seriesId, t.season, t.number),
		index('episode_status_idx').on(t.status)
	]
);

/**
 * The lines of an episode's subtitles the AI found witty enough to stand alone, for the opening
 * title card. One row per episode looked at: no lines means it found none.
 */
export const episodeQuotes = pgTable('episode_quotes', {
	episodeId: integer('episode_id')
		.primaryKey()
		.references(() => episode.id, { onDelete: 'cascade' }),
	/** The WebVTT file they come from, in the episode's HLS folder. */
	file: text('file').notNull(),
	quotes: jsonb('quotes').$type<string[]>().notNull().default([]),
	createdAt: timestamp('created_at').notNull().defaultNow()
});

/** The title to show: the one set by hand, the AI's, or the one from the file name. */
export const episodeTitle = sql<string>`coalesce(${episode.customTitle}, ${episode.aiTitle}, ${episode.title})`;

/** `ambiguous`: several series could be it, the user chooses (`candidates`). */
export const seriesInfoStatus = pgEnum('series_info_status', ['found', 'ambiguous', 'not_found']);

/** What a series is, from Wikidata and Wikipedia: looked up once, the first time its page is opened. */
export const seriesInfo = pgTable('series_info', {
	seriesId: integer('series_id')
		.primaryKey()
		.references(() => series.id, { onDelete: 'cascade' }),
	status: seriesInfoStatus('status').notNull(),
	wikidataId: text('wikidata_id'),
	title: text('title'),
	originalTitle: text('original_title'),
	startYear: integer('start_year'),
	endYear: integer('end_year'),
	seasons: integer('seasons'),
	episodes: integer('episodes'),
	synopsis: text('synopsis'),
	wikipediaUrl: text('wikipedia_url'),
	/** Wikipedia articles that list its episodes, in Spanish and in English. */
	episodePages: jsonb('episode_pages').$type<WikiPage[]>().notNull().default([]),
	/** For `ambiguous`: the series to choose from, best first. */
	candidates: jsonb('candidates')
		.$type<{ id: string; title: string; year: number | null; description: string | null }[]>()
		.notNull()
		.default([]),
	/** Titles and numbering the AI proposes for its episodes, until accepted or discarded. */
	titleProposal: jsonb('title_proposal').$type<TitleProposal[]>(),
	updatedAt: timestamp('updated_at').notNull().defaultNow()
});

export const watchProgress = pgTable(
	'watch_progress',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		episodeId: integer('episode_id')
			.notNull()
			.references(() => episode.id, { onDelete: 'cascade' }),
		positionSec: real('position_sec').notNull(),
		completed: boolean('completed').notNull().default(false),
		/** Taken out of «Seguir viendo» by hand; playing it again brings it back. */
		dismissed: boolean('dismissed').notNull().default(false),
		updatedAt: timestamp('updated_at').notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.episodeId] }),
		index('watch_progress_user_idx').on(t.userId, t.updatedAt)
	]
);

/** One per user and day; regenerating replaces its items. */
export const playlist = pgTable(
	'playlist',
	{
		id: serial('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		day: date('day').notNull(),
		targetMinutes: integer('target_minutes').notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [unique('playlist_user_day').on(t.userId, t.day)]
);

export const playlistItem = pgTable(
	'playlist_item',
	{
		playlistId: integer('playlist_id')
			.notNull()
			.references(() => playlist.id, { onDelete: 'cascade' }),
		position: integer('position').notNull(),
		episodeId: integer('episode_id')
			.notNull()
			.references(() => episode.id, { onDelete: 'cascade' }),
		watched: boolean('watched').notNull().default(false)
	},
	(t) => [primaryKey({ columns: [t.playlistId, t.position] })]
);

/** Made by hand: episodes are added one by one from a series page to the active list. */
export const userList = pgTable(
	'user_list',
	{
		id: serial('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [index('user_list_user_idx').on(t.userId)]
);

export const userListItem = pgTable(
	'user_list_item',
	{
		listId: integer('list_id')
			.notNull()
			.references(() => userList.id, { onDelete: 'cascade' }),
		/** Part of the key: an episode is in a list at most once. */
		episodeId: integer('episode_id')
			.notNull()
			.references(() => episode.id, { onDelete: 'cascade' }),
		position: integer('position').notNull(),
		watched: boolean('watched').notNull().default(false)
	},
	(t) => [primaryKey({ columns: [t.listId, t.episodeId] })]
);

export const workerState = pgEnum('worker_state', ['running', 'paused', 'stopped']);

/** Single row (id 1): survives restarts, so a stopped worker stays stopped. */
export const worker = pgTable('worker', {
	id: integer('id').primaryKey().default(1),
	state: workerState('state').notNull().default('running')
});

/** `pending`: found by the scan, not yet probed nor with a thumbnail. */
export const movieStatus = pgEnum('movie_status', ['pending', 'ready', 'error']);

/** A film in CINEMA_DIR: catalogued as is, never converted. */
export const movie = pgTable(
	'movie',
	{
		id: serial('id').primaryKey(),
		/** Path relative to CINEMA_DIR. */
		path: text('path').notNull().unique(),
		/** Derived from the file name on every scan. */
		title: text('title').notNull(),
		/** Set by hand; shown instead of `title` and kept across scans. */
		customTitle: text('custom_title'),
		year: integer('year'),
		size: bigint('size', { mode: 'number' }).notNull(),
		mtime: timestamp('mtime').notNull(),
		/** Set when the file is missing from the last scan. */
		missing: boolean('missing').notNull().default(false),
		status: movieStatus('status').notNull().default('pending'),
		error: text('error'),
		durationSec: real('duration_sec'),
		/** e.g. `1920×1080 · h264 · HDR`. */
		video: text('video'),
		audioTracks: jsonb('audio_tracks').$type<AudioTrack[]>().notNull().default([]),
		subtitles: jsonb('subtitles').$type<AudioTrack[]>().notNull().default([]),
		/** The file's chapters (usually the disc's); `null` until the file has been read for them. */
		chapters: jsonb('chapters').$type<Chapter[]>(),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [index('movie_status_idx').on(t.status)]
);

/** The same tags as series': «infantil» is what a child's account may see (#17). */
export const movieTag = pgTable(
	'movie_tag',
	{
		movieId: integer('movie_id')
			.notNull()
			.references(() => movie.id, { onDelete: 'cascade' }),
		tagId: integer('tag_id')
			.notNull()
			.references(() => tag.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.movieId, t.tagId] }), index('movie_tag_tag_idx').on(t.tagId)]
);

/** Where each user is in each film, saved while mpv plays it. Like watch_progress. */
export const movieProgress = pgTable(
	'movie_progress',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		movieId: integer('movie_id')
			.notNull()
			.references(() => movie.id, { onDelete: 'cascade' }),
		positionSec: real('position_sec').notNull(),
		completed: boolean('completed').notNull().default(false),
		updatedAt: timestamp('updated_at').notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.userId, t.movieId] })]
);

/**
 * Time actually watched, per user, day, slot and episode or film: what the positions saved while playing
 * moved forward. Children's, for the adults' page (#17); adults' own, for them to ask about,
 * unless they turn it off (`userSettings.keepHistory`).
 */
export const watchTime = pgTable(
	'watch_time',
	{
		id: serial('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** In the server's time zone, like `playlist.day`. */
		day: date('day').notNull(),
		/**
		 * The 10-minute slot of the day it was watched in, as the minute it starts (21:10 is 1270), so
		 * that a finer slot later needs no migration. Null before slots were kept: the whole day.
		 */
		minute: integer('minute'),
		episodeId: integer('episode_id').references(() => episode.id, { onDelete: 'cascade' }),
		movieId: integer('movie_id').references(() => movie.id, { onDelete: 'cascade' }),
		/** A TV channel, live: its id in channels.ts. */
		channelId: text('channel_id'),
		/** A Dailymotion video (#66). */
		dailymotionId: text('dailymotion_id').references(() => dailymotionVideo.xid, {
			onDelete: 'cascade'
		}),
		seconds: real('seconds').notNull().default(0)
	},
	(t) => [
		// All but one are null: they are compared as equal, so there is one row per thing and day.
		unique('watch_time_user_day_item')
			.on(t.userId, t.day, t.minute, t.episodeId, t.movieId, t.channelId, t.dailymotionId)
			.nullsNotDistinct(),
		check('watch_time_minute', sql`${t.minute} between 0 and 1439`),
		check(
			'watch_time_one_item',
			sql`num_nonnulls(${t.episodeId}, ${t.movieId}, ${t.channelId}, ${t.dailymotionId}) = 1`
		)
	]
);

/**
 * When a child may watch video (#18): slots per weekday, in the server's time zone. A child with no
 * slots at all has no schedule; with some, a day without slots has no video.
 */
export const kidSchedule = pgTable(
	'kid_schedule',
	{
		id: serial('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** 0 Monday … 6 Sunday. */
		weekday: integer('weekday').notNull(),
		/** Minutes since midnight; the end is not included. */
		startMinute: integer('start_minute').notNull(),
		endMinute: integer('end_minute').notNull()
	},
	(t) => [
		index('kid_schedule_user_idx').on(t.userId),
		check('kid_schedule_weekday', sql`${t.weekday} between 0 and 6`),
		check(
			'kid_schedule_minutes',
			sql`0 <= ${t.startMinute} and ${t.startMinute} < ${t.endMinute} and ${t.endMinute} <= 1440`
		)
	]
);

/** A child's other rules (#18). */
export const kidSettings = pgTable('kid_settings', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	/** Video a day at most; null: no limit. */
	dailyMinutes: integer('daily_minutes'),
	/** «Puede ver vídeos»: off, no video at all, whatever the schedule. */
	videoEnabled: boolean('video_enabled').notNull().default(true),
	/** «No, hasta mañana»: off until this day (server time zone, like `playlist.day`). */
	videoOffUntil: date('video_off_until'),
	/**
	 * «¿Sigues ahí?» (#77): asked after this many episodes started by themselves, with nobody
	 * touching anything; null, never.
	 */
	askEvery: integer('ask_every').default(3)
});

/** `ambiguous`: several films could be it, the user chooses (`candidates`). */
export const movieInfoStatus = pgEnum('movie_info_status', ['found', 'ambiguous', 'not_found']);

/** What a film is, from Wikidata and Wikipedia: looked up once, the first time its page is opened. */
export const movieInfo = pgTable('movie_info', {
	movieId: integer('movie_id')
		.primaryKey()
		.references(() => movie.id, { onDelete: 'cascade' }),
	status: movieInfoStatus('status').notNull(),
	wikidataId: text('wikidata_id'),
	title: text('title'),
	originalTitle: text('original_title'),
	year: integer('year'),
	minutes: integer('minutes'),
	directors: jsonb('directors').$type<string[]>().notNull().default([]),
	cast: jsonb('cast').$type<string[]>().notNull().default([]),
	genres: jsonb('genres').$type<string[]>().notNull().default([]),
	countries: jsonb('countries').$type<string[]>().notNull().default([]),
	imdbId: text('imdb_id'),
	synopsis: text('synopsis'),
	/** `wikipedia`, or `ai` when there was no article and the AI wrote it. */
	synopsisSource: text('synopsis_source').$type<'wikipedia' | 'ai'>(),
	wikipediaUrl: text('wikipedia_url'),
	/** For `ambiguous`: the films to choose from, best first. */
	candidates: jsonb('candidates')
		.$type<
			{
				id: string;
				title: string;
				year: number | null;
				directors: string[];
				description: string | null;
			}[]
		>()
		.notNull()
		.default([]),
	/** Names the AI gave the chapters, by their start: `null` until asked for. */
	scenes: jsonb('scenes').$type<SceneName[]>(),
	/** Awards won (`won`) and nominations, with their year when Wikidata has it. */
	awards: jsonb('awards')
		.$type<{ name: string; year: number | null; won: boolean }[]>()
		.notNull()
		.default([]),
	/** The film series it is part of, with its place in each when known. */
	sagas: jsonb('sagas').$type<{ name: string; order: number | null }[]>().notNull().default([]),
	writers: jsonb('writers').$type<string[]>().notNull().default([]),
	composers: jsonb('composers').$type<string[]>().notNull().default([]),
	cinematographers: jsonb('cinematographers').$type<string[]>().notNull().default([]),
	blackAndWhite: boolean('black_and_white').notNull().default(false),
	silent: boolean('silent').notNull().default(false),
	/**
	 * Which of Wikidata's details it has (`FILM_DETAILS_VERSION`): older ones are read again in
	 * the background, by their saved id.
	 */
	detailsVersion: integer('details_version').notNull().default(0),
	updatedAt: timestamp('updated_at').notNull().defaultNow()
});

/** The title to show: the one set by hand, or the one from the file name. */
export const movieTitle = sql<string>`coalesce(${movie.customTitle}, ${movie.title})`;

/** App-wide settings changed from the panel, only by the first user: e.g. the OpenRouter key. */
export const appSetting = pgTable('app_setting', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	updatedAt: timestamp('updated_at').notNull().defaultNow()
});

/**
 * A named list of what Ollama's vision model looks for in episodes (episode-labels.ts), made in
 * Ajustes → Casa: «Animales», «Lugares»… Each labelling uses one.
 */
export const labelSet = pgTable('label_set', {
	id: serial('id').primaryKey(),
	name: text('name').notNull().unique(),
	/** Lowercase, separated by commas, each once. */
	labels: text('labels').notNull(),
	createdAt: timestamp('created_at').notNull().defaultNow()
});

/**
 * What Ollama's vision model saw in an episode (episode-labels.ts), looking for the labels of a
 * set: one row per label seen, with the seconds of the frames it was seen in. Labelling again with
 * that set replaces its rows only. Apart from `tag`: those are set by hand and mean something
 * («infantil»); these are the model's.
 */
export const episodeLabel = pgTable(
	'episode_label',
	{
		episodeId: integer('episode_id')
			.notNull()
			.references(() => episode.id, { onDelete: 'cascade' }),
		setId: integer('set_id')
			.notNull()
			.references(() => labelSet.id, { onDelete: 'cascade' }),
		label: text('label').notNull(),
		times: jsonb('times').$type<number[]>().notNull().default([])
	},
	(t) => [
		primaryKey({ columns: [t.episodeId, t.setId, t.label] }),
		index('episode_label_label_idx').on(t.label)
	]
);

export const labelJobState = pgEnum('label_job_state', ['queued', 'running', 'failed', 'done']);

/**
 * Episodes to be labelled with a set, in order: kept, so a restart goes on with the queue. The last
 * ones done stay as history (Gestión → Etiquetado); a failure stays until retried or dismissed.
 */
export const labelJob = pgTable(
	'label_job',
	{
		id: serial('id').primaryKey(),
		episodeId: integer('episode_id')
			.notNull()
			.references(() => episode.id, { onDelete: 'cascade' }),
		setId: integer('set_id')
			.notNull()
			.references(() => labelSet.id, { onDelete: 'cascade' }),
		state: labelJobState('state').notNull().default('queued'),
		position: real('position').notNull(),
		error: text('error'),
		/** Frames looked at, once done. */
		frames: integer('frames'),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		startedAt: timestamp('started_at'),
		finishedAt: timestamp('finished_at')
	},
	(t) => [index('label_job_state_idx').on(t.state, t.position)]
);

export const subtitleJobState = pgEnum('subtitle_job_state', [
	'queued',
	'running',
	'done',
	'failed'
]);

/**
 * Subtitles made by Whisper (auto-subtitles.ts): what was asked for, in the order it is made, and
 * how it went; shown and managed in Gestión → Subtítulos. Kept, so a restart goes on with the
 * queue; the last ones done and every failure stay as its history.
 */
export const subtitleJob = pgTable(
	'subtitle_job',
	{
		id: serial('id').primaryKey(),
		episodeId: integer('episode_id').references(() => episode.id, { onDelete: 'cascade' }),
		movieId: integer('movie_id').references(() => movie.id, { onDelete: 'cascade' }),
		/** ISO 639-2, of the audio track to subtitle. */
		lang: text('lang').notNull(),
		state: subtitleJobState('state').notNull().default('queued'),
		/** In the queue, the lowest first: «ponerlo el primero» gives it one below the lowest. */
		position: real('position').notNull(),
		error: text('error'),
		/** Phrases made, once done. */
		cues: integer('cues'),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		startedAt: timestamp('started_at'),
		finishedAt: timestamp('finished_at')
	},
	(t) => [
		index('subtitle_job_state_idx').on(t.state, t.position),
		check('subtitle_job_one_item', sql`num_nonnulls(${t.episodeId}, ${t.movieId}) = 1`)
	]
);

export const logLevel = pgEnum('log_level', ['info', 'warn', 'error']);

/** What the server did and what went wrong, shown in /logs. Older than 30 days is deleted. */
export const logEntry = pgTable(
	'log_entry',
	{
		id: serial('id').primaryKey(),
		at: timestamp('at').notNull().defaultNow(),
		level: logLevel('level').notNull(),
		/** Part of the app it comes from: `worker`, `scan`, `thumbnail`, `http`… */
		source: text('source').notNull(),
		message: text('message').notNull(),
		/** E.g. the episode id, or an error's message and stack (with ffmpeg's output). */
		details: jsonb('details').$type<Record<string, unknown>>()
	},
	(t) => [index('log_entry_at_idx').on(t.at), index('log_entry_level_idx').on(t.level, t.at)]
);

export const chatRole = pgEnum('chat_role', ['user', 'assistant']);

/** Conversations about a film with the AI, one per user and film. */
export const movieChatMessage = pgTable(
	'movie_chat_message',
	{
		id: serial('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		movieId: integer('movie_id')
			.notNull()
			.references(() => movie.id, { onDelete: 'cascade' }),
		role: chatRole('role').notNull(),
		content: text('content').notNull(),
		/** Web pages the answer is based on, when the web search is on. */
		sources: jsonb('sources').$type<{ url: string; title: string }[]>().notNull().default([]),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [index('movie_chat_message_user_movie_idx').on(t.userId, t.movieId, t.id)]
);

export const userSettings = pgTable('user_settings', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	/** ISO 639-2, e.g. `spa`. Null means the episode's default. */
	audioLang: text('audio_lang'),
	/** ISO 639-2, or null for no subtitles. */
	subtitleLang: text('subtitle_lang'),
	/** Partial; missing keys use the defaults. */
	subtitleStyle: jsonb('subtitle_style').$type<Partial<SubtitleStyle>>(),
	/** When an episode ends, the next one starts (the series' or the playlist's). */
	autoNext: boolean('auto_next').notNull().default(true),
	/**
	 * «¿Sigues ahí?» (#77) for an adult, for who falls asleep with the series: after this many episodes
	 * started by themselves with nobody touching anything; null, never. A child's is in kid_settings.
	 */
	askEvery: integer('ask_every'),
	/** Films in the living room start with the Cine Club intro (DATA_DIR/cortinilla.mp4), if present. */
	intro: boolean('intro').notNull().default(true),
	/** The app's colours (themes.ts); unknown ones are the default. */
	theme: text('theme').notNull().default('jellycartoon'),
	/** What an adult watches is kept in watch_time, for them to ask about; a child's, always. */
	keepHistory: boolean('keep_history').notNull().default(true),
	/** Langua, the language app: where to send audio clips (`send_clip` in voice commands), and its token. */
	languaUrl: text('langua_url'),
	languaToken: text('langua_token'),
	/** Where "add to list" on a series page puts episodes. */
	activeListId: integer('active_list_id').references(() => userList.id, { onDelete: 'set null' }),
	/** The road mode's trips are kept (#81): where one has been, so off until turned on. */
	recordTrips: boolean('record_trips').notNull().default(false),
	/** A line from the library's subtitles on a black screen when the app opens, as Frasier's title cards. */
	openingQuote: boolean('opening_quote').notNull().default(true)
});

/**
 * A trip in the road mode (#81), from the browser's GPS while it is open: positions in a row, a new
 * trip after a long stop. Only for whoever turned it on in Ajustes.
 */
export const trip = pgTable(
	'trip',
	{
		id: serial('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		startedAt: timestamp('started_at').notNull(),
		/** Its last position's time. */
		endedAt: timestamp('ended_at').notNull(),
		/** Metres, along its positions. */
		distance: real('distance').notNull().default(0),
		/** m/s, the fastest the GPS said. */
		maxSpeed: real('max_speed'),
		/** The road mode's route, if there was one: «Plaza de Zocodover, Toledo». */
		destination: text('destination'),
		/** Its positions, [longitude, latitude, seconds since 1970], one every ~25 m. */
		line: jsonb('line').$type<[number, number, number][]>().notNull().default([])
	},
	(t) => [index('trip_user_started_idx').on(t.userId, t.startedAt)]
);

/**
 * A photo taken from the road mode (#81): its JPEG in DATA_DIR/fotos (photoFile), here when and
 * where, and the trip being kept then, if any. Only for whoever took it.
 */
export const tripPhoto = pgTable(
	'trip_photo',
	{
		id: serial('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		tripId: integer('trip_id').references(() => trip.id, { onDelete: 'set null' }),
		takenAt: timestamp('taken_at').notNull(),
		/** Where, if the GPS said. */
		lon: real('lon'),
		lat: real('lat')
	},
	(t) => [index('trip_photo_user_taken_idx').on(t.userId, t.takenAt)]
);

/**
 * A place kept with its name (#151): «Casa», «Trabajo», «Centro comercial tal». The road mode offers
 * them first, and the voice knows them by their name. Only for whoever kept it.
 */
export const savedPlace = pgTable(
	'saved_place',
	{
		id: serial('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		lon: doublePrecision('lon').notNull(),
		lat: doublePrecision('lat').notNull(),
		/** Its address, if it was found by searching: «Calle Mayor 5, Toledo, España». */
		address: text('address')
	},
	(t) => [index('saved_place_user_idx').on(t.userId)]
);

/**
 * A route kept with its name (#151): its stops in order, the first where it starts, the last where
 * it ends, and the way by car between them as openrouteservice gave it when it was kept.
 */
export const savedRoute = pgTable(
	'saved_route',
	{
		id: serial('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		stops: jsonb('stops').$type<RouteStop[]>().notNull(),
		line: jsonb('line').$type<LngLat[]>().notNull(),
		/** Metres and seconds, all of it. */
		distance: real('distance').notNull(),
		duration: real('duration').notNull()
	},
	(t) => [index('saved_route_user_idx').on(t.userId)]
);

/**
 * A device that keeps routes' maps (#164), such as the car's tablet: named on itself, its id made
 * there and kept in its browser. Not a trusted device of the house (#141): that one changes how
 * people sign in on it.
 */
export const mapDevice = pgTable('map_device', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	lastSeenAt: timestamp('last_seen_at').notNull().defaultNow()
});

/**
 * A route's map on a device (#164): ordered from any device, done by that one when the app opens on
 * it. `remove`, ordered away; the row goes once it is.
 */
export const routeMapState = pgEnum('route_map_state', [
	'pending',
	'downloading',
	'ready',
	'failed',
	'remove'
]);

export const routeMap = pgTable(
	'route_map',
	{
		routeId: integer('route_id')
			.notNull()
			.references(() => savedRoute.id, { onDelete: 'cascade' }),
		deviceId: text('device_id')
			.notNull()
			.references(() => mapDevice.id, { onDelete: 'cascade' }),
		state: routeMapState('state').notNull().default('pending'),
		/** 0 to 1, while downloading. */
		progress: real('progress').notNull().default(0),
		bytes: bigint('bytes', { mode: 'number' }),
		/** The map and the route it was cut from (route-maps.ts): another now, it is old. */
		version: text('version'),
		/** Why it failed, as the device says it. */
		problem: text('problem'),
		updatedAt: timestamp('updated_at').notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.routeId, t.deviceId] })]
);

/**
 * The fridge (#131): the house's post-its, for everyone to see. Written by an adult, in their colour;
 * until a day if given (then gone), or until someone peels it off. The shopping list is one more,
 * `list`, with its items (fridgeItem): there is one, made the first time it is looked at.
 */
export const fridgeNoteKind = pgEnum('fridge_note_kind', ['note', 'list']);

export const fridgeNote = pgTable(
	'fridge_note',
	{
		id: serial('id').primaryKey(),
		kind: fridgeNoteKind('kind').notNull().default('note'),
		/** Who wrote it; the list's, who made it first. Null if their account is gone. */
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		text: text('text').notNull(),
		/** Shown until the end of this day, in the house's time zone; null, until peeled off. */
		until: date('until'),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [index('fridge_note_created_idx').on(t.createdAt)]
);

/** An item of the shopping list: ticked off when bought, and cleared later. */
export const fridgeItem = pgTable(
	'fridge_item',
	{
		id: serial('id').primaryKey(),
		noteId: integer('note_id')
			.notNull()
			.references(() => fridgeNote.id, { onDelete: 'cascade' }),
		text: text('text').notNull(),
		done: boolean('done').notNull().default(false),
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [index('fridge_item_note_idx').on(t.noteId)]
);

/** `ignored`: no album tag, e.g. a download rather than a CD rip; not shown. */
export const trackStatus = pgEnum('track_status', ['pending', 'ready', 'ignored', 'error']);

/**
 * A track's Opus copy, for listening away from home (#64). Without it, the FLAC is played. An Opus
 * file is `ready` as it is: it is its own copy.
 */
export const trackOpus = pgEnum('track_opus', ['pending', 'ready', 'error']);

/** `not_found`: neither MusicBrainz nor the Cover Art Archive had it. */
export const coverStatus = pgEnum('cover_status', ['pending', 'found', 'not_found']);

/** A folder of MUSIC_DIR: one album, or one disc of a double album. */
export const album = pgTable('album', {
	id: serial('id').primaryKey(),
	/** Relative to MUSIC_DIR. */
	folder: text('folder').notNull().unique(),
	/** From its tracks' tags, refreshed as they are read. */
	title: text('title').notNull(),
	/** Set by hand; shown instead of `title` and kept across scans. */
	customTitle: text('custom_title'),
	artist: text('artist').notNull(),
	/** Set by hand; shown instead of `artist` and kept across scans. */
	customArtist: text('custom_artist'),
	/** MusicBrainz disc id, from the CDTOC tag some rippers (fre:ac) write. */
	discId: text('disc_id'),
	coverStatus: coverStatus('cover_status').notNull().default('pending'),
	/**
	 * Where its cover came from, to fetch it again: `release/<MusicBrainz id>` or
	 * `release-group/<id>` in the Cover Art Archive, or `embedded` (its first track's picture).
	 */
	coverSource: text('cover_source'),
	updatedAt: timestamp('updated_at')
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date())
});

/** A FLAC or Opus file in MUSIC_DIR; its tags are read in the background after a scan. */
export const track = pgTable(
	'track',
	{
		id: serial('id').primaryKey(),
		/** Known once its tags are read. */
		albumId: integer('album_id').references(() => album.id, { onDelete: 'set null' }),
		/** Relative to MUSIC_DIR. */
		path: text('path').notNull().unique(),
		size: bigint('size', { mode: 'number' }).notNull(),
		mtime: timestamp('mtime').notNull(),
		/** Set when the file is missing from the last scan. */
		missing: boolean('missing').notNull().default(false),
		status: trackStatus('status').notNull().default('pending'),
		error: text('error'),
		/** From the tags; the file name until they are read. */
		title: text('title').notNull(),
		/** Set by hand; shown instead of `title` and kept when the tags are read again. */
		customTitle: text('custom_title'),
		artist: text('artist'),
		/** ALBUMARTIST, when the ripper wrote it. */
		albumArtist: text('album_artist'),
		/** ALBUM as tagged: the album's title comes from it. */
		albumTitle: text('album_title'),
		number: integer('number'),
		durationSec: real('duration_sec'),
		/** Made again when the FLAC changes. */
		opus: trackOpus('opus').notNull().default('pending'),
		opusError: text('opus_error')
	},
	(t) => [index('track_album_idx').on(t.albumId, t.number)]
);

/** The titles to show: the one set by hand, or the one from the tags. */
export const albumTitle = sql<string>`coalesce(${album.customTitle}, ${album.title})`;
export const trackTitle = sql<string>`coalesce(${track.customTitle}, ${track.title})`;
export const albumArtistName = sql<string>`coalesce(${album.customArtist}, ${album.artist})`;
/**
 * A track's artist: its own, unless it has none or it is the album's as tagged; then the album's,
 * so renaming the album's artist renames its tracks' too (but not a compilation's).
 */
export const trackArtist = sql<string>`case when ${track.artist} is null or ${track.artist} = ${album.artist} then ${albumArtistName} else ${track.artist} end`;

/** A playlist of tracks, shared by the whole house. */
export const musicPlaylist = pgTable('music_playlist', {
	id: serial('id').primaryKey(),
	name: text('name').notNull(),
	createdAt: timestamp('created_at').notNull().defaultNow()
});

/** A track in a playlist; the same one can be there more than once. */
export const musicPlaylistItem = pgTable(
	'music_playlist_item',
	{
		id: serial('id').primaryKey(),
		playlistId: integer('playlist_id')
			.notNull()
			.references(() => musicPlaylist.id, { onDelete: 'cascade' }),
		trackId: integer('track_id')
			.notNull()
			.references(() => track.id, { onDelete: 'cascade' }),
		position: integer('position').notNull()
	},
	(t) => [index('music_playlist_item_playlist_idx').on(t.playlistId, t.position)]
);

export * from './auth.schema';

/**
 * The password for music apps (Subsonic, #27): apart from the account's, which Better Auth keeps
 * only as a hash. The apps send md5(password + salt), and checking it needs the password itself.
 * Random, generated in Ajustes, and revoked there; it only opens the music API.
 */
export const appPassword = pgTable('app_password', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	password: text('password').notNull(),
	createdAt: timestamp('created_at').notNull().defaultNow()
});

/**
 * What each user marks as a favourite in music apps (Subsonic's star, #27): an artist, an album or
 * a track, by the protocol's id (`ar-…`, `al-…`, `tr-…`). An artist has no row of its own: its id
 * is its name.
 */
export const musicStar = pgTable(
	'music_star',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		itemId: text('item_id').notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.userId, t.itemId] })]
);

/**
 * Each user's music queue, to go on where it was on any device: saved by the browser that plays
 * it, and by music apps (Subsonic's play queue, #27). The last one saved is the one that counts.
 */
export const musicQueue = pgTable('music_queue', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	/** In the order they sound, shuffled or not. */
	trackIds: integer('track_ids').array().notNull(),
	currentIndex: integer('current_index').notNull().default(0),
	positionSec: real('position_sec').notNull().default(0),
	shuffle: boolean('shuffle').notNull().default(false),
	repeat: boolean('repeat').notNull().default(false),
	single: boolean('single').notNull().default(false),
	/** A station instead of the tracks. */
	radioUuid: text('radio_uuid'),
	/** A podcast episode instead of the tracks. */
	podcastEpisodeId: integer('podcast_episode_id').references(() => podcastEpisode.id, {
		onDelete: 'set null'
	}),
	/** Where it was saved from, as it is shown: «la TV», «el móvil», «Tempus». */
	changedBy: text('changed_by').notNull(),
	/** Set by the app, to the millisecond: closing the player only clears its own save. */
	updatedAt: timestamp('updated_at', { precision: 3 }).notNull()
});

/** A public podcast, from its RSS feed; one row however many users follow it. */
export const podcast = pgTable('podcast', {
	id: serial('id').primaryKey(),
	feedUrl: text('feed_url').notNull().unique(),
	title: text('title').notNull(),
	author: text('author'),
	description: text('description'),
	imageUrl: text('image_url'),
	/** The feed's own page, for the credits. */
	link: text('link'),
	/** When its feed was last read, and why it failed then, if it did. */
	checkedAt: timestamp('checked_at'),
	lastError: text('last_error'),
	createdAt: timestamp('created_at').notNull().defaultNow()
});

export const podcastEpisode = pgTable(
	'podcast_episode',
	{
		id: serial('id').primaryKey(),
		podcastId: integer('podcast_id')
			.notNull()
			.references(() => podcast.id, { onDelete: 'cascade' }),
		/** The feed's own id for it (its audio URL when it has none). */
		guid: text('guid').notNull(),
		title: text('title').notNull(),
		description: text('description'),
		audioUrl: text('audio_url').notNull(),
		durationSec: integer('duration_sec'),
		publishedAt: timestamp('published_at'),
		imageUrl: text('image_url')
	},
	(t) => [
		unique('podcast_episode_guid_unique').on(t.podcastId, t.guid),
		index('podcast_episode_published_idx').on(t.podcastId, t.publishedAt)
	]
);

/** The podcasts each user follows. */
export const podcastSubscription = pgTable(
	'podcast_subscription',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		podcastId: integer('podcast_id')
			.notNull()
			.references(() => podcast.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.userId, t.podcastId] })]
);

/** Where each user is in each episode, to go on from there. */
export const podcastProgress = pgTable(
	'podcast_progress',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		episodeId: integer('episode_id')
			.notNull()
			.references(() => podcastEpisode.id, { onDelete: 'cascade' }),
		positionSec: real('position_sec').notNull(),
		completed: boolean('completed').notNull().default(false),
		updatedAt: timestamp('updated_at').notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.userId, t.episodeId] })]
);

/**
 * The house's recipe book (#60): recipes saved from a cooking site's page, its schema.org Recipe
 * read and its steps made ready for the kitchen (short, with their timers). The whole house's, not
 * each person's; who saved it, for the credits.
 */
export const recipe = pgTable('recipe', {
	id: serial('id').primaryKey(),
	title: text('title').notNull(),
	servings: integer('servings'),
	ingredients: jsonb('ingredients').$type<string[]>().notNull().default([]),
	steps: jsonb('steps').$type<RecipeStep[]>().notNull(),
	imageUrl: text('image_url'),
	/** The page it came from: one recipe per page. */
	sourceUrl: text('source_url').notNull().unique(),
	/** The site's name, or its host: «Las recetas de…». */
	sourceName: text('source_name').notNull(),
	createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
	createdAt: timestamp('created_at').notNull().defaultNow()
});

/**
 * The house's favourite cooking sites (#60): their sitemaps read, to search their recipes by the
 * words of their addresses, by voice or in Recetas; one is imported (a `recipe`) when chosen.
 */
export const recipeSite = pgTable('recipe_site', {
	id: serial('id').primaryKey(),
	/** Without «www.»: «directoalpaladar.com». */
	host: text('host').notNull().unique(),
	/** og:site_name, or its title, or its host. */
	name: text('name').notNull(),
	/** How many pages its sitemaps listed, the last time they were read. */
	pages: integer('pages').notNull().default(0),
	/** When they were read, and why that failed, if it did. */
	indexedAt: timestamp('indexed_at'),
	lastError: text('last_error'),
	createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
	createdAt: timestamp('created_at').notNull().defaultNow()
});

/** A page of a favourite site's sitemaps, by the words of its address. */
export const recipeSitePage = pgTable(
	'recipe_site_page',
	{
		id: serial('id').primaryKey(),
		siteId: integer('site_id')
			.notNull()
			.references(() => recipeSite.id, { onDelete: 'cascade' }),
		url: text('url').notNull(),
		/** The sitemap it was listed in: its pages are replaced only when that one changes. */
		sitemap: text('sitemap').notNull().default(''),
		/** As shown: «Macarrones gratinados con bechamel». */
		title: text('title').notNull(),
		/** Folded (lower case, no accents) and between spaces, for searching. */
		words: text('words').notNull()
	},
	// Also the index by site: it comes first.
	(t) => [unique().on(t.siteId, t.url)]
);

/**
 * The sitemaps a favourite site had the last time they were read, and when each changed, as its
 * index said (lastmod): the next time, one that did not change is not asked for again.
 */
export const recipeSiteSitemap = pgTable(
	'recipe_site_sitemap',
	{
		siteId: integer('site_id')
			.notNull()
			.references(() => recipeSite.id, { onDelete: 'cascade' }),
		url: text('url').notNull(),
		lastmod: text('lastmod'),
		/** An index of other sitemaps: always read again, it is what says which ones changed. */
		isIndex: boolean('is_index').notNull().default(false)
	},
	(t) => [primaryKey({ columns: [t.siteId, t.url] })]
);

/**
 * A child who enters with a parent's permission (#141): its avatar, and its credential, which only
 * the server knows and uses once one of its parents or guardians says yes (kid-login.ts). Encrypted
 * with a key from BETTER_AUTH_SECRET, so a copy of the database is not enough to enter.
 */
export const kidProfile = pgTable('kid_profile', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	/** One of AVATARS (avatars.ts). */
	avatar: text('avatar').notNull(),
	/** Without a password: chooses its avatar, and one of its parents or guardians lets it in. */
	byApproval: boolean('by_approval').notNull().default(false),
	/** Its credential, encrypted: `iv.tag.data` in base64url. */
	secret: text('secret')
});

/** Who lets each child in: its parents or guardians, adults of the house. */
export const kidGuardian = pgTable(
	'kid_guardian',
	{
		kidId: text('kid_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		guardianId: text('guardian_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' })
	},
	(t) => [
		primaryKey({ columns: [t.kidId, t.guardianId] }),
		index('kid_guardian_guardian_idx').on(t.guardianId)
	]
);

/**
 * A device an adult marked as the house's (the living room's TV): only there do the children
 * choose their avatar to ask to enter. Known by a cookie whose hash is kept here.
 */
export const trustedDevice = pgTable('trusted_device', {
	id: serial('id').primaryKey(),
	tokenHash: text('token_hash').notNull().unique(),
	/** «la TV del salón»: what the parents read when a child asks from it. */
	name: text('name').notNull(),
	createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	lastSeenAt: timestamp('last_seen_at').notNull().defaultNow()
});

export const kidLoginState = pgEnum('kid_login_state', ['pending', 'approved', 'denied', 'used']);

/** A child asking to enter from a trusted device, and what its parents said. */
export const kidLoginRequest = pgTable(
	'kid_login_request',
	{
		id: text('id').primaryKey(),
		kidId: text('kid_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		deviceId: integer('device_id')
			.notNull()
			.references(() => trustedDevice.id, { onDelete: 'cascade' }),
		state: kidLoginState('state').notNull().default('pending'),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		/** Not answered by then, it is no longer asked. */
		expiresAt: timestamp('expires_at').notNull(),
		decidedBy: text('decided_by').references(() => user.id, { onDelete: 'set null' }),
		/** When its session ends, if it was let in. */
		until: timestamp('until'),
		/** The other children the adult let in with it, to watch together (#160). */
		companions: jsonb('companions').$type<string[]>().notNull().default([])
	},
	(t) => [index('kid_login_request_device_idx').on(t.deviceId, t.createdAt)]
);

/**
 * Children watching together with the one signed in (#160): what it watches counts for each of them
 * too, and the strictest of their limits applies to all. Added by an adult, when letting it in or
 * later; until the end of the day or of that session, unless taken off before.
 */
export const kidCompanion = pgTable(
	'kid_companion',
	{
		/** The one signed in, on the TV. */
		kidId: text('kid_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		companionId: text('companion_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/**
		 * Its session on the TV: on another device of its own (its tablet), it watches alone. Gone
		 * with it.
		 */
		sessionId: text('session_id')
			.notNull()
			.references(() => session.id, { onDelete: 'cascade' }),
		addedBy: text('added_by').references(() => user.id, { onDelete: 'set null' }),
		addedAt: timestamp('added_at').notNull().defaultNow(),
		until: timestamp('until').notNull()
	},
	(t) => [primaryKey({ columns: [t.kidId, t.companionId] })]
);

/** «Hasta las 20:00», «hoy»: meanwhile, the child enters on that device without asking again. */
export const kidPermit = pgTable(
	'kid_permit',
	{
		kidId: text('kid_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		deviceId: integer('device_id')
			.notNull()
			.references(() => trustedDevice.id, { onDelete: 'cascade' }),
		until: timestamp('until').notNull(),
		grantedBy: text('granted_by').references(() => user.id, { onDelete: 'set null' })
	},
	(t) => [primaryKey({ columns: [t.kidId, t.deviceId] })]
);

/**
 * A phone or browser where an adult wants the app's notices (Web Push, push.ts): for now, a child
 * asking to enter (#141). What the browser's push service gave, to send to it.
 */
export const pushSubscription = pgTable(
	'push_subscription',
	{
		id: serial('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		endpoint: text('endpoint').notNull().unique(),
		p256dh: text('p256dh').notNull(),
		auth: text('auth').notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [index('push_subscription_user_idx').on(t.userId)]
);

export const dailymotionSourceKind = pgEnum('dailymotion_source_kind', ['user', 'playlist']);

/**
 * A Dailymotion account or playlist the adults chose for the children (#66): only their videos are
 * shown and played, always with the family filter.
 */
export const dailymotionSource = pgTable(
	'dailymotion_source',
	{
		id: serial('id').primaryKey(),
		kind: dailymotionSourceKind('kind').notNull(),
		/** Dailymotion's id of the account or the playlist. */
		xid: text('xid').notNull(),
		name: text('name').notNull(),
		image: text('image'),
		addedBy: text('added_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [unique('dailymotion_source_kind_xid').on(t.kind, t.xid)]
);

/** A Dailymotion video that has been played here: its title, for the history and «Ahora». */
export const dailymotionVideo = pgTable('dailymotion_video', {
	xid: text('xid').primaryKey(),
	title: text('title').notNull(),
	/** The account's name, as Dailymotion shows it. */
	owner: text('owner').notNull(),
	durationSec: real('duration_sec'),
	thumbnail: text('thumbnail'),
	updatedAt: timestamp('updated_at').notNull().defaultNow()
});

/** Where each user is in each Dailymotion video, as with the episodes. */
export const dailymotionProgress = pgTable(
	'dailymotion_progress',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		videoXid: text('video_xid')
			.notNull()
			.references(() => dailymotionVideo.xid, { onDelete: 'cascade' }),
		positionSec: real('position_sec').notNull(),
		completed: boolean('completed').notNull().default(false),
		updatedAt: timestamp('updated_at').notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.userId, t.videoXid] })]
);

/**
 * A child's homework from the cartoons they watched (#142): exercises the AI proposed from the
 * episodes' subtitles, which an adult reviewed, and the child's way through them.
 */
export const homeworkStatus = pgEnum('homework_status', ['draft', 'assigned', 'done']);

export const homework = pgTable(
	'homework',
	{
		id: serial('id').primaryKey(),
		kidId: text('kid_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** The adult who prepared it; null if their account is gone. */
		createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
		status: homeworkStatus('status').notNull().default('draft'),
		/** «Dexter, capítulo 1», as the child sees it. */
		title: text('title').notNull(),
		/** `es`, or `en` to practise English. */
		language: text('language').notNull().default('es'),
		/** AGE_BANDS' id. */
		band: text('band').notNull(),
		episodeIds: jsonb('episode_ids').$type<number[]>().notNull(),
		exercises: jsonb('exercises').$type<Exercise[]>().notNull().default([]),
		rules: jsonb('rules').$type<HomeworkRules>().notNull(),
		/** One per exercise, as the child goes. */
		steps: jsonb('steps').$type<Step[]>().notNull().default([]),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		assignedAt: timestamp('assigned_at'),
		doneAt: timestamp('done_at')
	},
	(t) => [index('homework_kid_idx').on(t.kidId, t.status)]
);
