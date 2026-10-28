import {
	date,
	doublePrecision,
	foreignKey,
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
import type { BillDetails } from 'comun/bills.ts';
import type { ExpenseLine } from 'comun/expenses.ts';
import { user } from './auth.schema.ts';
import { family, familyRows } from './family.schema.ts';

/**
 * Each family's expenses (#253; jellycartoon's #194, #232): from a receipt's photo read by a vision
 * model, said by voice at home, written by hand, or a fixed one added each month; and the bills of
 * its supplies. In cents. Every row with its family, and only seen from it; what hangs from an
 * expense (its lines, its bill) or makes one (a fixed one), of the same family.
 */

const familyId = () =>
	text('family_id')
		.notNull()
		.references(() => family.id, { onDelete: 'cascade' });

export const expenseSource = pgEnum('expense_source', ['ticket', 'voz', 'mano', 'fijo', 'factura']);

/** Paid every month (rent, light, a subscription): added by itself on its day. */
export const recurringExpense = pgTable(
	'recurring_expense',
	{
		id: serial('id').primaryKey(),
		familyId: familyId(),
		name: text('name').notNull(),
		category: text('category').notNull(),
		amount: integer('amount').notNull(),
		/** Day of the month, 1 to 28: every month has it. */
		day: integer('day').notNull(),
		/** The last month it was added, `YYYY-MM`; null, none yet. */
		lastMonth: text('last_month'),
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		unique('recurring_expense_family_id').on(t.familyId, t.id),
		familyRows('recurring_expense_own', t.familyId)
	]
).enableRLS();

export const expense = pgTable(
	'expense',
	{
		id: serial('id').primaryKey(),
		familyId: familyId(),
		/** The day it was paid, as the receipt says. */
		date: date('date').notNull(),
		/** The shop, or what it was («Gasolina»). */
		store: text('store').notNull(),
		/** One of EXPENSE_CATEGORIES (expenses.ts). */
		category: text('category').notNull(),
		total: integer('total').notNull(),
		source: expenseSource('source').notNull(),
		/** Who put it in; null if their account is gone, or the house's voice. */
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		/** The receipt's photo, or the bill's PDF or photo, kept in the family's storage (storage.ts). */
		receipt: text('receipt'),
		/** The fixed one it came from. */
		recurringId: integer('recurring_id'),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		index('expense_family_date_idx').on(t.familyId, t.date),
		unique('expense_family_id').on(t.familyId, t.id),
		// Of its own family. Deleting a fixed one, its expenses are let go of first (expenses.ts).
		foreignKey({
			name: 'expense_recurring_fk',
			columns: [t.familyId, t.recurringId],
			foreignColumns: [recurringExpense.familyId, recurringExpense.id]
		}),
		familyRows('expense_own', t.familyId)
	]
).enableRLS();

/** A receipt's lines, as read from it and corrected. */
export const expenseLine = pgTable(
	'expense_line',
	{
		id: serial('id').primaryKey(),
		familyId: familyId(),
		expenseId: integer('expense_id').notNull(),
		position: integer('position').notNull(),
		text: text('text').notNull(),
		/** Units, or kg. */
		quantity: doublePrecision('quantity'),
		amount: integer('amount').notNull(),
		/** One of LINE_TAGS (expenses.ts); the ones read before there were tags, «Otros». */
		tag: text('tag').notNull().default('Otros')
	},
	(t) => [
		index('expense_line_expense_idx').on(t.expenseId),
		foreignKey({
			name: 'expense_line_expense_fk',
			columns: [t.familyId, t.expenseId],
			foreignColumns: [expense.familyId, expense.id]
		}).onDelete('cascade'),
		familyRows('expense_line_own', t.familyId)
	]
).enableRLS();

/**
 * A bill's supply (#232), with its expense (who, when, the total, the parts as its lines): the
 * period and what was consumed, and what is particular to each kind in `details`.
 */
export const bill = pgTable(
	'bill',
	{
		id: serial('id').primaryKey(),
		familyId: familyId(),
		expenseId: integer('expense_id').notNull().unique(),
		/** One of BILL_KINDS (bills.ts). */
		kind: text('kind').notNull(),
		periodStart: date('period_start').notNull(),
		periodEnd: date('period_end').notNull(),
		/** In `unit`; null if the bill does not say. */
		consumption: doublePrecision('consumption'),
		/** One of BILL_UNITS. */
		unit: text('unit').notNull(),
		details: jsonb('details').$type<BillDetails>().notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		index('bill_kind_period_idx').on(t.familyId, t.kind, t.periodEnd),
		foreignKey({
			name: 'bill_expense_fk',
			columns: [t.familyId, t.expenseId],
			foreignColumns: [expense.familyId, expense.id]
		}).onDelete('cascade'),
		familyRows('bill_own', t.familyId)
	]
).enableRLS();

/**
 * A favourite expense, to put in again with a touch or by voice («el café de siempre»): as it was
 * when marked, the amount changeable when used. Not a fixed one: nothing is added by itself.
 */
export const expenseFavorite = pgTable(
	'expense_favorite',
	{
		id: serial('id').primaryKey(),
		familyId: familyId(),
		store: text('store').notNull(),
		category: text('category').notNull(),
		/** Null: said each time. */
		total: integer('total'),
		lines: jsonb('lines').$type<ExpenseLine[]>().notNull().default([]),
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [familyRows('expense_favorite_own', t.familyId)]
).enableRLS();
