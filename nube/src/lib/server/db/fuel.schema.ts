import {
	boolean,
	date,
	index,
	integer,
	pgTable,
	serial,
	text,
	timestamp,
	unique
} from 'drizzle-orm/pg-core';
import { expense } from './expenses.schema.ts';
import { family, familyRows } from './family.schema.ts';

/**
 * Energía → Previsión (#513, phase 2): what the family heats with that comes in units (butane
 * bottles, pellet sacks), to know how long what is at home lasts with the cold to come. One of
 * each kind per family.
 */
export const fuel = pgTable(
	'fuel',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: ['butano', 'pellet'] }).notNull(),
		/** Put on as soon as bought (one bottle, swapped with the delivery man): each purchase starts one. */
		startsOnBuy: boolean('starts_on_buy').notNull(),
		/** Days ahead to be told it runs out. */
		alertDays: integer('alert_days').notNull().default(5),
		/** What the family says one lasts in winter, in days: what is used until it is learned. */
		guessDays: integer('guess_days'),
		/** The day it was told to run out on: told again only if it comes sooner. */
		notifiedFor: date('notified_for'),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [unique('fuel_family_kind').on(t.familyId, t.kind), familyRows('fuel_own', t.familyId)]
).enableRLS();

/**
 * What happened with a fuel: units bought (`compra`, maybe from an expense in Dinero), one started
 * (`empezada`: the days between two are what one lasted), or an expense that looked like it and
 * was not (`descartada`, not asked about again).
 */
export const fuelEvent = pgTable(
	'fuel_event',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		fuelId: integer('fuel_id')
			.notNull()
			.references(() => fuel.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: ['compra', 'empezada', 'descartada'] }).notNull(),
		day: date('day').notNull(),
		quantity: integer('quantity').notNull().default(1),
		expenseId: integer('expense_id').references(() => expense.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		index('fuel_event_fuel_day_idx').on(t.fuelId, t.day),
		familyRows('fuel_event_own', t.familyId)
	]
).enableRLS();
