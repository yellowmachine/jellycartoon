import {
	boolean,
	foreignKey,
	date,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	serial,
	text,
	timestamp,
	unique
} from 'drizzle-orm/pg-core';
import type { RecipeStep } from '#lib/recipe.ts';
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
