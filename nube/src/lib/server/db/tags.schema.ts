import {
	foreignKey,
	index,
	integer,
	pgTable,
	primaryKey,
	serial,
	text,
	unique
} from 'drizzle-orm/pg-core';
import { family, familyRows } from './family.schema.ts';

/**
 * Piloto de Electric (#394): las etiquetas de las series de una casa, aquí y no en ella. La casa
 * tiene una copia de solo lectura, que baja de estas tablas. `tag.id`, único entre familias, es el
 * mismo número en esa copia. Las series siguen en la casa: `series_id` es su número allí, sin clave
 * foránea, y solo tiene sentido junto con la familia.
 */

const familyId = () =>
	text('family_id')
		.notNull()
		.references(() => family.id, { onDelete: 'cascade' });

/** Lowercase: «Infantil» and «infantil» are the same tag. */
export const tag = pgTable(
	'tag',
	{
		familyId: familyId(),
		id: serial('id').primaryKey(),
		name: text('name').notNull()
	},
	(t) => [
		unique('tag_family_id').on(t.familyId, t.id),
		unique('tag_name_unique').on(t.familyId, t.name),
		familyRows('tag_own', t.familyId)
	]
).enableRLS();

export const seriesTag = pgTable(
	'series_tag',
	{
		familyId: familyId(),
		seriesId: integer('series_id').notNull(),
		tagId: integer('tag_id').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.familyId, t.seriesId, t.tagId] }),
		foreignKey({
			columns: [t.familyId, t.tagId],
			foreignColumns: [tag.familyId, tag.id]
		}).onDelete('cascade'),
		index('series_tag_tag_idx').on(t.familyId, t.tagId),
		familyRows('series_tag_own', t.familyId)
	]
).enableRLS();
