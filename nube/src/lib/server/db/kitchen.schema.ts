import {
	boolean,
	foreignKey,
	date,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	serial,
	text,
	timestamp,
	unique
} from 'drizzle-orm/pg-core';
import type { RecipeStep } from 'comun/recipe.ts';
import type { Place } from 'comun/weather.ts';
import { user } from './auth.schema.ts';
import { family, familyRows } from './family.schema.ts';

/**
 * The kitchen of each family (#253), as jellycartoon's (#131, #60): the fridge's post-its and its
 * shopping list, and the recipe book. Every row with its family, and only seen from it.
 */

const familyId = () =>
	text('family_id')
		.notNull()
		.references(() => family.id, { onDelete: 'cascade' });

/**
 * The fridge: the family's post-its, written by an adult, in their colour; until a day if given
 * (then gone), or until someone peels it off. The shopping list is one more, `list`, with its items
 * (fridgeItem): one per family, made the first time it is looked at.
 */
export const fridgeNoteKind = pgEnum('fridge_note_kind', ['note', 'list']);

export const fridgeNote = pgTable(
	'fridge_note',
	{
		id: serial('id').primaryKey(),
		familyId: familyId(),
		kind: fridgeNoteKind('kind').notNull().default('note'),
		/** Who wrote it; the list's, who made it first. Null if their account is gone, or the house. */
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		text: text('text').notNull(),
		/** Shown until the end of this day, in the family's time zone; null, until peeled off. */
		until: date('until'),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		index('fridge_note_family_idx').on(t.familyId, t.createdAt),
		// For its items to point at a note of their own family (fridgeItem).
		unique('fridge_note_family_id').on(t.familyId, t.id),
		familyRows('fridge_note_own', t.familyId)
	]
).enableRLS();

/** An item of the shopping list: ticked off when bought, and cleared later. */
export const fridgeItem = pgTable(
	'fridge_item',
	{
		id: serial('id').primaryKey(),
		familyId: familyId(),
		noteId: integer('note_id').notNull(),
		text: text('text').notNull(),
		done: boolean('done').notNull().default(false),
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		index('fridge_item_note_idx').on(t.noteId),
		// Its note, of its own family: foreign keys are checked without row-level security, and an
		// item could otherwise hang from another family's list.
		foreignKey({
			name: 'fridge_item_note_fk',
			columns: [t.familyId, t.noteId],
			foreignColumns: [fridgeNote.familyId, fridgeNote.id]
		}).onDelete('cascade'),
		familyRows('fridge_item_own', t.familyId)
	]
).enableRLS();

/**
 * The family's recipe book: recipes saved from a cooking site's page, its schema.org Recipe read
 * and its steps made ready for the kitchen (short, with their timers). The whole family's; who
 * saved it, for the credits.
 */
export const recipe = pgTable(
	'recipe',
	{
		id: serial('id').primaryKey(),
		familyId: familyId(),
		title: text('title').notNull(),
		servings: integer('servings'),
		ingredients: jsonb('ingredients').$type<string[]>().notNull().default([]),
		steps: jsonb('steps').$type<RecipeStep[]>().notNull(),
		imageUrl: text('image_url'),
		/** The page it came from: one recipe per page, in each family. */
		sourceUrl: text('source_url').notNull(),
		/** The site's name, or its host: «Las recetas de…». */
		sourceName: text('source_name').notNull(),
		createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [unique().on(t.familyId, t.sourceUrl), familyRows('recipe_own', t.familyId)]
).enableRLS();

/**
 * The family's settings: its OpenRouter key (encrypted, secret-box.ts) for the AI, and the recipe
 * whose picture is behind the book's page.
 */
export const familySettings = pgTable(
	'family_settings',
	{
		familyId: text('family_id')
			.primaryKey()
			.references(() => family.id, { onDelete: 'cascade' }),
		openrouterKey: text('openrouter_key'),
		/**
		 * The family's AI stopped (ai-block.ts): since when, and why in our words («No queda saldo en
		 * OpenRouter»…); null, going. Kept, so that a restart does not send to OpenRouter again.
		 */
		aiBlockedAt: timestamp('ai_blocked_at'),
		aiBlockedWhy: text('ai_blocked_why'),
		/** openrouteservice's key (#78), for the road mode's routes and places; encrypted. */
		orsKey: text('ors_key'),
		/** The voice's model (OpenRouter), for its orders; null, the default one. */
		voiceModel: text('voice_model'),
		/** «Cómo es la voz de la casa», free text in its instructions; null, none. */
		voiceStyle: text('voice_style'),
		/** «Buscar en internet desde la voz»: on or off, and where to look. */
		voiceWeb: jsonb('voice_web').$type<{ on: boolean; hints: string }>(),
		/** «Horas de silencio», «HH:MM» to «HH:MM»; null, none. */
		voiceQuiet: jsonb('voice_quiet').$type<{ from: string; to: string }>(),
		/**
		 * «Aprender de lo que se habla» (#331, phase 6): after each order, the AI looks for something
		 * worth remembering; off by default, as it runs at the same time as the answer's voice.
		 */
		voiceLearn: boolean('voice_learn').notNull().default(false),
		/**
		 * How the satellites Seilide serves speak (#296): Gemini's voice, how it says things, and what
		 * they say while the AI thinks; null, Kore as the house's, with its phrases.
		 */
		satelliteVoice: jsonb('satellite_voice').$type<{
			voice: string;
			tone: string;
			fillers: string[];
		}>(),
		/** «Dónde vivís» (Ajustes → Familia), optional: the weather on the home page and by voice. */
		place: jsonb('place').$type<Place>(),
		recipesBackdrop: integer('recipes_backdrop').references(() => recipe.id, {
			onDelete: 'set null'
		}),
		updatedAt: timestamp('updated_at')
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date())
	},
	(t) => [familyRows('family_settings_own', t.familyId)]
).enableRLS();

/**
 * The family's favourite cooking sites (jellycartoon's #60): their sitemaps read, to search their
 * recipes by the words of their addresses, by voice or in Recetas; one is imported (a `recipe`)
 * when chosen.
 */
export const recipeSite = pgTable(
	'recipe_site',
	{
		id: serial('id').primaryKey(),
		familyId: familyId(),
		/** Without «www.»: «directoalpaladar.com». */
		host: text('host').notNull(),
		/** og:site_name, or its title, or its host. */
		name: text('name').notNull(),
		/** How many pages its sitemaps listed, the last time they were read. */
		pages: integer('pages').notNull().default(0),
		/** When they were read, and why that failed, if it did. */
		indexedAt: timestamp('indexed_at'),
		lastError: text('last_error'),
		createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		unique().on(t.familyId, t.host),
		// For its pages and sitemaps to belong to a site of their own family.
		unique('recipe_site_family_id').on(t.familyId, t.id),
		familyRows('recipe_site_own', t.familyId)
	]
).enableRLS();

/** A page of a favourite site's sitemaps, by the words of its address. */
export const recipeSitePage = pgTable(
	'recipe_site_page',
	{
		id: serial('id').primaryKey(),
		familyId: familyId(),
		siteId: integer('site_id').notNull(),
		url: text('url').notNull(),
		/** The sitemap it was listed in: its pages are replaced only when that one changes. */
		sitemap: text('sitemap').notNull().default(''),
		/** As shown: «Macarrones gratinados con bechamel». */
		title: text('title').notNull(),
		/** Folded (lower case, no accents) and between spaces, for searching. */
		words: text('words').notNull()
	},
	(t) => [
		// Also the index by site: it comes first.
		unique().on(t.siteId, t.url),
		foreignKey({
			name: 'recipe_site_page_site_fk',
			columns: [t.familyId, t.siteId],
			foreignColumns: [recipeSite.familyId, recipeSite.id]
		}).onDelete('cascade'),
		familyRows('recipe_site_page_own', t.familyId)
	]
).enableRLS();

/**
 * The sitemaps a favourite site had the last time they were read, and when each changed, as its
 * index said (lastmod): the next time, one that did not change is not asked for again.
 */
export const recipeSiteSitemap = pgTable(
	'recipe_site_sitemap',
	{
		familyId: familyId(),
		siteId: integer('site_id').notNull(),
		url: text('url').notNull(),
		lastmod: text('lastmod'),
		/** An index of other sitemaps: always read again, it is what says which ones changed. */
		isIndex: boolean('is_index').notNull().default(false)
	},
	(t) => [
		primaryKey({ columns: [t.siteId, t.url] }),
		foreignKey({
			name: 'recipe_site_sitemap_site_fk',
			columns: [t.familyId, t.siteId],
			foreignColumns: [recipeSite.familyId, recipeSite.id]
		}).onDelete('cascade'),
		familyRows('recipe_site_sitemap_own', t.familyId)
	]
).enableRLS();
