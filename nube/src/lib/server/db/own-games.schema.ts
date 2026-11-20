import {
	bigint,
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	serial,
	text,
	timestamp,
	uniqueIndex
} from 'drizzle-orm/pg-core';
import { user } from './auth.schema.ts';
import { family, familyRows } from './family.schema.ts';
import type { GameLookup } from 'comun/wikidata/game-lookup.ts';

/**
 * «Tus juegos» (#564): the games a family keeps in its own S3/R2/Backblaze…, one folder per
 * console as the house's GAMES_DIR, played in Seilide without uploading them anywhere. Seilide
 * keeps the bucket, sealed, and the list of its games (own-games.ts); the ROM goes from the bucket
 * through Seilide to the browser. And what each person keeps of them: cartridge, saved games, time.
 */
export const gameSource = pgTable(
	'game_source',
	{
		familyId: text('family_id')
			.primaryKey()
			.references(() => family.id, { onDelete: 'cascade' }),
		/** The bucket (storage-bucket.ts' `Bucket`, its folder the games'), sealed (family-secret.ts). */
		bucket: text('bucket').notNull(),
		/** What it says, without its keys: «abc.r2.cloudflarestorage.com · musica · Juegos/». */
		label: text('label').notNull(),
		/** Its keys can write too: said in Ajustes, as read-only ones are enough. */
		canWrite: boolean('can_write').notNull().default(false),
		/** Listing it now: since when (one at a time per family; a stale one, from a restart, is let go). */
		scanningSince: timestamp('scanning_since'),
		/** The last listing that ended, and how many games it found. */
		indexedAt: timestamp('indexed_at'),
		games: integer('games').notNull().default(0),
		/** Why the last one failed, to say in Ajustes and in Juegos. */
		problem: text('problem'),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [familyRows('game_source_own', t.familyId)]
).enableRLS();

/**
 * A game of the bucket. Kept when its file is gone (`present` false), and when the bucket is taken
 * out: what each person saved of it is still theirs if it comes back.
 */
export const ownGame = pgTable(
	'own_game',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		/** Its console's folder, one of SYSTEMS (comun/game-systems.ts). */
		system: text('system').notNull(),
		/** Its file's name in that folder, as the URL has it. */
		file: text('file').notNull(),
		/** Its key in the bucket, whole (the folder included). */
		key: text('key').notNull(),
		size: bigint('size', { mode: 'number' }).notNull(),
		/** An arcade game's BIOS (`Juegos/arcade/neogeo.zip`), as FBNeo's list says; null, none. */
		biosKey: text('bios_key'),
		/** «Super Mario World», without region or version. */
		title: text('title').notNull(),
		/** Its file's name without extension: No-Intro's, as libretro names its pictures. */
		fullName: text('full_name').notNull(),
		/** In the bucket the last time it was listed. */
		present: boolean('present').notNull().default(true),
		/** Whether libretro has its box (`si`, `no`); null, not asked yet. */
		cover: text('cover').$type<'si' | 'no'>(),
		/** And its title screen, for the top of its page. */
		titleScreen: text('title_screen').$type<'si' | 'no'>(),
		/** Its card from Wikidata (comun's lookUpGameInfo), looked up the first time its page opens. */
		info: jsonb('info').$type<GameLookup>()
	},
	(t) => [
		uniqueIndex('own_game_family_system_file').on(t.familyId, t.system, t.file),
		familyRows('own_game_own', t.familyId)
	]
).enableRLS();

/** A person's cartridge save of a game (#176), gzipped in the family's storage (area
 * `juegos-cartuchos`, `<id>.srm.gz`). */
export const ownGameCartridge = pgTable(
	'own_game_cartridge',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		gameId: integer('game_id')
			.notNull()
			.references(() => ownGame.id, { onDelete: 'cascade' }),
		updatedAt: timestamp('updated_at').notNull().defaultNow()
	},
	(t) => [
		uniqueIndex('own_game_cartridge_user_game').on(t.userId, t.gameId),
		index('own_game_cartridge_game').on(t.gameId),
		familyRows('own_game_cartridge_own', t.familyId)
	]
).enableRLS();

/** A person's saved game: its emulator state, and its picture if it had one, in the
 * family's storage (area `juegos-partidas`, `<id>.state` and `<id>.png`). */
export const ownGameSave = pgTable(
	'own_game_save',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		gameId: integer('game_id')
			.notNull()
			.references(() => ownGame.id, { onDelete: 'cascade' }),
		hasPicture: boolean('has_picture').notNull().default(false),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		index('own_game_save_user_game').on(t.userId, t.gameId),
		familyRows('own_game_save_own', t.familyId)
	]
).enableRLS();

/** How long a person played a game in one go (#176), as the player reports it. */
export const ownGameSession = pgTable(
	'own_game_session',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		gameId: integer('game_id')
			.notNull()
			.references(() => ownGame.id, { onDelete: 'cascade' }),
		startedAt: timestamp('started_at').notNull().defaultNow(),
		endedAt: timestamp('ended_at').notNull().defaultNow(),
		seconds: integer('seconds').notNull().default(0)
	},
	(t) => [
		index('own_game_session_user_game').on(t.userId, t.gameId),
		familyRows('own_game_session_own', t.familyId)
	]
).enableRLS();
