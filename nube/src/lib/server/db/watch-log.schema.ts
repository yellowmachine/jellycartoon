import { date, index, integer, pgTable, real, serial, text, unique } from 'drizzle-orm/pg-core';
import { user } from './auth.schema.ts';
import { family, familyRows } from './family.schema.ts';

/**
 * What a person watched at home (#421): a copy the house sends, to read here without asking it. One
 * row per person, 10-minute slot and thing, with the seconds of that slot and its titles, as there
 * is no catalogue here and a series deleted at home keeps its history.
 */
export const watchLog = pgTable(
	'watch_log',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** In the house's time zone. */
		day: date('day').notNull(),
		/** The minute of the day its slot starts: 21:10 is 1270. */
		minute: integer('minute').notNull(),
		/**
		 * The house's own id for it: `e12` an episode, `m3` a film, `c…` a channel, `s4` a shortcut,
		 * `j7` a game (its sessions, all in the slot each started in).
		 */
		item: text('item').notNull(),
		kind: text('kind', { enum: ['serie', 'pelicula', 'canal', 'web', 'juego'] }).notNull(),
		/** The series, for an episode. */
		seriesTitle: text('series_title'),
		/** The episode's, or the film's, the channel's, the shortcut's or the game's name. */
		title: text('title').notNull(),
		season: integer('season'),
		number: integer('number'),
		seconds: real('seconds').notNull()
	},
	(t) => [
		unique('watch_log_slot').on(t.userId, t.day, t.minute, t.item),
		index('watch_log_family_day_idx').on(t.familyId, t.day),
		familyRows('watch_log_own', t.familyId)
	]
).enableRLS();
