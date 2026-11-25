import {
	boolean,
	date,
	doublePrecision,
	foreignKey,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	real,
	serial,
	text,
	timestamp,
	unique,
	uniqueIndex
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

export const expenseSource = pgEnum('expense_source', [
	'ticket',
	'voz',
	'mano',
	'fijo',
	'factura',
	// A payment brought in from the bank (#502).
	'banco'
]);

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
		/** Every year, in this month (1 to 12); null, every month. */
		month: integer('month'),
		/** With `month`, every so many months from it: 2, 3, 4 or 6; null, every year. */
		every: integer('every'),
		/** The last month it was added, `YYYY-MM`; null, none yet. */
		lastMonth: text('last_month'),
		/** «Se paga desde»: the account to keep money in, as they call it; null, not said. */
		paidFrom: text('paid_from'),
		/** «Avísame», days before; 0, never; null, each one's usual (family_member). */
		notice: integer('notice'),
		/** Told to the other adults too. */
		noticeAll: boolean('notice_all').notNull().default(false),
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
		/**
		 * The SHA-256 of the receipt or bill as chosen, before the browser makes a photo smaller (#440):
		 * the same file put in twice. Null, none or before there were.
		 */
		fileHash: text('file_hash'),
		/**
		 * Paid in another currency (ISO 4217, «USD»): `total` and the lines are in euros, and here what
		 * the receipt said, in its cents, and the euros one of it was worth that day. `rate` null, not
		 * changed (the amounts are the receipt's). Null, paid in euros.
		 */
		currency: text('currency'),
		originalTotal: integer('original_total'),
		rate: doublePrecision('rate'),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		index('expense_family_date_idx').on(t.familyId, t.date),
		index('expense_family_file_hash_idx').on(t.familyId, t.fileHash),
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

/**
 * What came in (#384), in Dinero beside the expenses: a harvest sold, a refund, a payslip. In
 * cents. Its invoice, a photo or a PDF, kept in the family's storage (storage.ts, `ingresos`).
 */
/** Coming in every month or year (a payslip, a pension): added by itself on its day. */
export const recurringIncome = pgTable(
	'recurring_income',
	{
		id: serial('id').primaryKey(),
		familyId: familyId(),
		concept: text('concept').notNull(),
		/** One of INCOME_CATEGORIES (comun/income.ts). */
		category: text('category').notNull(),
		amount: integer('amount').notNull(),
		/** Day of the month, 1 to 28: every month has it. */
		day: integer('day').notNull(),
		/** Every year, in this month (1 to 12); null, every month. */
		month: integer('month'),
		/** The last month it was added, `YYYY-MM`; null, none yet. */
		lastMonth: text('last_month'),
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		unique('recurring_income_family_id').on(t.familyId, t.id),
		familyRows('recurring_income_own', t.familyId)
	]
).enableRLS();

export const income = pgTable(
	'income',
	{
		id: serial('id').primaryKey(),
		familyId: familyId(),
		date: date('date').notNull(),
		/** What it was: «Cosecha de almendra». */
		concept: text('concept').notNull(),
		/** One of INCOME_CATEGORIES (comun/income.ts). */
		category: text('category').notNull(),
		amount: integer('amount').notNull(),
		/** Who wrote it down; null if their account is gone. */
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		/** Its invoice's name in the family's storage; null, none. */
		document: text('document'),
		/** The fixed one it came from. */
		recurringId: integer('recurring_id'),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		index('income_family_date_idx').on(t.familyId, t.date),
		// Of its own family. Deleting a fixed one, its income is let go of first (income.ts).
		foreignKey({
			name: 'income_recurring_fk',
			columns: [t.familyId, t.recurringId],
			foreignColumns: [recurringIncome.familyId, recurringIncome.id]
		}),
		familyRows('income_own', t.familyId)
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
 * Two expenses that looked the same and are not (#440, «No es repetido»): not said again. The
 * smaller id first.
 */
export const expenseNotDuplicate = pgTable(
	'expense_not_duplicate',
	{
		familyId: familyId(),
		a: integer('a').notNull(),
		b: integer('b').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.familyId, t.a, t.b] }),
		foreignKey({
			name: 'expense_not_duplicate_a_fk',
			columns: [t.familyId, t.a],
			foreignColumns: [expense.familyId, expense.id]
		}).onDelete('cascade'),
		foreignKey({
			name: 'expense_not_duplicate_b_fk',
			columns: [t.familyId, t.b],
			foreignColumns: [expense.familyId, expense.id]
		}).onDelete('cascade'),
		familyRows('expense_not_duplicate_own', t.familyId)
	]
).enableRLS();

/** One of the expenses a bill or a payment gathers, as it was: to put it back. */
export interface MergedPart {
	date: string;
	store: string;
	category: string;
	total: number;
	source: 'mano' | 'voz';
	userId: string | null;
	lines: { text: string; quantity: number | null; amount: number; tag: string }[];
	/** What pointed at it, and now at the one that gathers it. */
	wishes: number[];
	payments: number[];
}

/**
 * «Juntarlos»: the expenses put in one by one that a bill (or a bank's payment) turned out to gather,
 * deleted so as not to count twice; kept here, as they were, for «Separarlos».
 */
export const expenseMerge = pgTable(
	'expense_merge',
	{
		id: serial('id').primaryKey(),
		familyId: familyId(),
		expenseId: integer('expense_id').notNull(),
		parts: jsonb('parts').$type<MergedPart[]>().notNull(),
		/** It had no lines (a payment): it has theirs. */
		tookLines: boolean('took_lines').notNull().default(false),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		index('expense_merge_expense_idx').on(t.expenseId),
		foreignKey({
			name: 'expense_merge_expense_fk',
			columns: [t.familyId, t.expenseId],
			foreignColumns: [expense.familyId, expense.id]
		}).onDelete('cascade'),
		familyRows('expense_merge_own', t.familyId)
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

/**
 * The family's own tags for receipt lines (#459): «Pan», «Agua», beside the fixed LINE_TAGS the
 * model puts. Given to lines by expenseTagRule; one with no rule left is deleted.
 */
export const expenseTag = pgTable(
	'expense_tag',
	{
		id: serial('id').primaryKey(),
		familyId: familyId(),
		name: text('name').notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		unique('expense_tag_family_id').on(t.familyId, t.id),
		unique('expense_tag_family_name').on(t.familyId, t.name),
		familyRows('expense_tag_own', t.familyId)
	]
).enableRLS();

/**
 * «barra picos» → Pan (#459): every line with that text, as lineKey (comun/expenses.ts) leaves it,
 * of any receipt, before or after, has that tag. Looked up when read, never copied to the lines: a
 * rule changed or gone changes them all. One tag per text, so the sums add up.
 */
export const expenseTagRule = pgTable(
	'expense_tag_rule',
	{
		familyId: familyId(),
		text: text('text').notNull(),
		tagId: integer('tag_id').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.familyId, t.text] }),
		index('expense_tag_rule_tag_idx').on(t.tagId),
		foreignKey({
			name: 'expense_tag_rule_tag_fk',
			columns: [t.familyId, t.tagId],
			foreignColumns: [expenseTag.familyId, expenseTag.id]
		}).onDelete('cascade'),
		familyRows('expense_tag_rule_own', t.familyId)
	]
).enableRLS();

/**
 * Calorías (#562): what each product of the receipts is, by its text as lineKey leaves it (as
 * expenseTagRule): estimated once by the AI, for every receipt, before or after, or corrected by
 * hand. Looked up when read, never copied to the lines.
 */
export const foodEstimate = pgTable(
	'food_estimate',
	{
		familyId: familyId(),
		text: text('text').notNull(),
		/** Eaten or drunk; false, it does not count (a bag, a gift card). */
		food: boolean('food').notNull(),
		/** Sold by weight: its line's quantity is kg. */
		byWeight: boolean('by_weight').notNull().default(false),
		/** Grams of one, as bought (a pack of six litres, about 6000); by weight, a usual purchase. */
		grams: real('grams').notNull().default(0),
		kcal100: real('kcal100').notNull().default(0),
		/** Corrected by a person: the AI does not touch it again. */
		byHand: boolean('by_hand').notNull().default(false),
		updatedAt: timestamp('updated_at').notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.familyId, t.text] }),
		familyRows('food_estimate_own', t.familyId)
	]
).enableRLS();

/**
 * What each request to the AI cost (#193), for Gastos → IA: the cloud's own and the house's (it
 * tells them, /api/casa/gasto-ia). In dollars, as OpenRouter says it.
 */
export const aiCost = pgTable(
	'ai_cost',
	{
		id: serial('id').primaryKey(),
		familyId: familyId(),
		at: timestamp('at').notNull().defaultNow(),
		/** Which app asked: `nube` or `casa`. */
		app: text('app').notNull(),
		/** Grouped by (comun/ai-spend.ts, `aiKind`). */
		kind: text('kind').notNull(),
		label: text('label').notNull(),
		cost: doublePrecision('cost').notNull(),
		/** The house's own id for it: one sent again (a lost answer) is not counted twice. */
		houseRef: text('house_ref')
	},
	(t) => [
		index('ai_cost_family_at_idx').on(t.familyId, t.at),
		uniqueIndex('ai_cost_family_house_ref_idx').on(t.familyId, t.houseRef),
		familyRows('ai_cost_own', t.familyId)
	]
).enableRLS();
