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
		/** Put on as soon as bought (one bottle, swapped with the delivery man): offered first on buying. */
		startsOnBuy: boolean('starts_on_buy').notNull(),
		/** Days ahead to be told it runs out. */
		alertDays: integer('alert_days').notNull().default(5),
		/** Each spot's since #628 (fuelSpot.guessDays); no longer read. */
		guessDays: integer('guess_days'),
		/** The day it was told to run out on: told again only if it comes sooner. */
		notifiedFor: date('notified_for'),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [unique('fuel_family_kind').on(t.familyId, t.kind), familyRows('fuel_own', t.familyId)]
).enableRLS();

/**
 * Where one is put on (#628): «Cocina», «Estufa»… Each has its own going and learns how long one
 * lasts there; the full ones at home are for any. With only one, its name is not shown.
 */
export const fuelSpot = pgTable(
	'fuel_spot',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		fuelId: integer('fuel_id')
			.notNull()
			.references(() => fuel.id, { onDelete: 'cascade' }),
		name: text('name').notNull().default(''),
		/** To heat: it goes with the cold. Without it (a cooker), each day the same. */
		heats: boolean('heats').notNull().default(true),
		/** What the family says one lasts here (in winter, if it heats), in days, until learned. */
		guessDays: integer('guess_days'),
		/** Put away (the stove, in summer): not shown, what it learned kept. */
		archivedAt: timestamp('archived_at'),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [index('fuel_spot_fuel_idx').on(t.fuelId), familyRows('fuel_spot_own', t.familyId)]
).enableRLS();

/**
 * What happened with a fuel: units bought (`compra`, maybe from an expense in Dinero), the full ones
 * at home put right (`ajuste`, so many more or fewer), or an expense that looked like it and was not
 * (`descartada`, not asked about again). `empezada` was one started, before `fuelUnit` (#628).
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
		kind: text('kind', { enum: ['compra', 'ajuste', 'empezada', 'descartada'] }).notNull(),
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

/**
 * One unit put on (#628): where, since when and until when (the day it ran out or the next was put
 * on; null, going), and the purchase it came from, if known.
 */
export const fuelUnit = pgTable(
	'fuel_unit',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		fuelId: integer('fuel_id')
			.notNull()
			.references(() => fuel.id, { onDelete: 'cascade' }),
		spotId: integer('spot_id')
			.notNull()
			.references(() => fuelSpot.id, { onDelete: 'cascade' }),
		startedOn: date('started_on').notNull(),
		endedOn: date('ended_on'),
		/** All of it used: what it lasted is learned from. Not, if taken away half full. */
		whole: boolean('whole').notNull().default(true),
		/** One of the full ones noted at home. Not, if it was there before anything was noted. */
		fromStock: boolean('from_stock').notNull().default(true),
		purchaseId: integer('purchase_id').references(() => fuelEvent.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		unique('fuel_unit_spot_started').on(t.spotId, t.startedOn),
		index('fuel_unit_fuel_idx').on(t.fuelId, t.startedOn),
		familyRows('fuel_unit_own', t.familyId)
	]
).enableRLS();
