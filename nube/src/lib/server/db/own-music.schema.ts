import {
	bigint,
	boolean,
	index,
	integer,
	pgTable,
	serial,
	text,
	timestamp,
	uniqueIndex
} from 'drizzle-orm/pg-core';
import { family, familyRows } from './family.schema.ts';

/**
 * «Tu música» (#534): the music a family keeps in its own S3/R2/Backblaze…, listened to in Seilide
 * without uploading it anywhere. Seilide keeps only what it read of it (own-music.ts): the bucket,
 * sealed, and an index of its albums and tracks; the audio goes from the bucket to the browser.
 */
export const musicSource = pgTable(
	'music_source',
	{
		familyId: text('family_id')
			.primaryKey()
			.references(() => family.id, { onDelete: 'cascade' }),
		/** The bucket (storage-bucket.ts' `Bucket`, its folder the music's), sealed (family-secret.ts). */
		bucket: text('bucket').notNull(),
		/** What it says, without its keys: «abc.r2.cloudflarestorage.com · musica · Música/». */
		label: text('label').notNull(),
		/** Its keys can write too: said in Ajustes, as read-only ones are enough. */
		canWrite: boolean('can_write').notNull().default(false),
		/** Indexing now: since when (one at a time per family; a stale one, from a restart, is let go). */
		scanningSince: timestamp('scanning_since'),
		/** How far the indexing is: files read of all. */
		done: integer('done').notNull().default(0),
		total: integer('total').notNull().default(0),
		/** The last one that ended, and what it found. */
		indexedAt: timestamp('indexed_at'),
		tracks: integer('tracks').notNull().default(0),
		/** Why the last one failed, to say in Ajustes and in the tab. */
		problem: text('problem'),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [familyRows('music_source_own', t.familyId)]
).enableRLS();

export const ownAlbum = pgTable(
	'own_album',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		/** The album's artist (or the first track's). */
		artist: text('artist').notNull(),
		year: integer('year'),
		/** Its cover: a picture in the bucket (`cover.jpg`, `folder.jpg`…), by its key. */
		coverKey: text('cover_key'),
		/** Or the one inside a track, kept in the family's storage (storage.ts, area `musica`). */
		coverFile: text('cover_file'),
		coverType: text('cover_type')
	},
	(t) => [
		uniqueIndex('own_album_family_title_artist').on(t.familyId, t.title, t.artist),
		familyRows('own_album_own', t.familyId)
	]
).enableRLS();

export const ownTrack = pgTable(
	'own_track',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		albumId: integer('album_id')
			.notNull()
			.references(() => ownAlbum.id, { onDelete: 'cascade' }),
		/** Its key in the bucket, whole (the folder included). */
		key: text('key').notNull(),
		/** What it was when read: the same, it is not read again. */
		etag: text('etag').notNull(),
		size: bigint('size', { mode: 'number' }).notNull(),
		title: text('title').notNull(),
		artist: text('artist').notNull(),
		disc: integer('disc'),
		number: integer('number'),
		durationSec: integer('duration_sec'),
		/** As the browser is asked whether it plays it: `audio/flac`, `audio/mp4; codecs="alac"`… */
		mime: text('mime').notNull()
	},
	(t) => [
		uniqueIndex('own_track_family_key').on(t.familyId, t.key),
		index('own_track_album').on(t.albumId),
		familyRows('own_track_own', t.familyId)
	]
).enableRLS();
