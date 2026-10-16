import {
	bigint,
	boolean,
	check,
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
import type { Chapter, SceneName } from '#lib/scenes.ts';
import type { SubtitleStyle } from '#lib/subtitle-style.ts';
import type { WikiPage } from '#lib/server/cinema/wikidata.ts';
import type { TitleProposal } from '#lib/episode-titles.ts';
import { user } from './auth.schema';

export const series = pgTable('series', {
	id: serial('id').primaryKey(),
	/** Folder name inside MEDIA_DIR. */
	folder: text('folder').notNull().unique(),
	title: text('title').notNull(),
	/** Episodes follow a story: playlists pick the next unwatched one instead of a random one. */
	serialized: boolean('serialized').notNull().default(true),
	/** Position in the conversion queue, set by dragging in Gestión; null goes last. */
	queueOrder: integer('queue_order'),
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
 * Time actually watched, per user, day and episode or film: what the positions saved while playing
 * moved forward. Only for children's accounts, for the adults' page (#17).
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
		episodeId: integer('episode_id').references(() => episode.id, { onDelete: 'cascade' }),
		movieId: integer('movie_id').references(() => movie.id, { onDelete: 'cascade' }),
		seconds: real('seconds').notNull().default(0)
	},
	(t) => [
		// One of the two is null: they are compared as equal, so there is one row per thing and day.
		unique('watch_time_user_day_item')
			.on(t.userId, t.day, t.episodeId, t.movieId)
			.nullsNotDistinct(),
		check('watch_time_one_item', sql`(${t.episodeId} is null) <> (${t.movieId} is null)`)
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
	dailyMinutes: integer('daily_minutes')
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
	/** Films in the living room start with the Cine Club intro (DATA_DIR/cortinilla.mp4), if present. */
	intro: boolean('intro').notNull().default(true),
	/** Where "add to list" on a series page puts episodes. */
	activeListId: integer('active_list_id').references(() => userList.id, { onDelete: 'set null' })
});

/** `ignored`: no album tag, e.g. a download rather than a CD rip; not shown. */
export const trackStatus = pgEnum('track_status', ['pending', 'ready', 'ignored', 'error']);

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
	updatedAt: timestamp('updated_at')
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date())
});

/** A FLAC file in MUSIC_DIR; its tags are read in the background after a scan. */
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
		durationSec: real('duration_sec')
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
