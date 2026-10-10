import {
	bigint,
	boolean,
	date,
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
import type { SubtitleStyle } from '#lib/subtitle-style.ts';
import { user } from './auth.schema';

export const series = pgTable('series', {
	id: serial('id').primaryKey(),
	/** Folder name inside MEDIA_DIR. */
	folder: text('folder').notNull().unique(),
	title: text('title').notNull(),
	/** Episodes follow a story: playlists pick the next unwatched one instead of a random one. */
	serialized: boolean('serialized').notNull().default(true),
	/** Position in the conversion queue, set by dragging in Biblioteca; null goes last. */
	queueOrder: integer('queue_order'),
	createdAt: timestamp('created_at').notNull().defaultNow()
});

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

/** The title to show: the one set by hand, or the one from the file name. */
export const episodeTitle = sql<string>`coalesce(${episode.customTitle}, ${episode.title})`;

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
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [index('movie_status_idx').on(t.status)]
);

/** The title to show: the one set by hand, or the one from the file name. */
export const movieTitle = sql<string>`coalesce(${movie.customTitle}, ${movie.title})`;

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
	/** Where "add to list" on a series page puts episodes. */
	activeListId: integer('active_list_id').references(() => userList.id, { onDelete: 'set null' })
});

export * from './auth.schema';
