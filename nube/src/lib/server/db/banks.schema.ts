import { sql } from 'drizzle-orm';
import {
	bigint,
	boolean,
	index,
	integer,
	pgPolicy,
	pgTable,
	primaryKey,
	serial,
	text,
	timestamp,
	unique
} from 'drizzle-orm/pg-core';
import { user } from './auth.schema.ts';
import { expense } from './expenses.schema.ts';
import { family, familyRows } from './family.schema.ts';
import { userRows } from './user.schema.ts';

/**
 * A person's bank (#502): bunq, by its API with a key of theirs, whose payments come into the
 * family's Dinero. The connection and its accounts are theirs and of no family (user.schema.ts):
 * nobody else sees them, and they go with them. What it brought in, the family's, beside its
 * expenses. The key, the private key and the session, among their secrets (user-secret-scope.ts).
 */

export const bankLink = pgTable(
	'bank_link',
	{
		userId: text('user_id')
			.primaryKey()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** Only `bunq` for now. */
		provider: text('provider').notNull(),
		/** Their user at the bank (bunq's UserPerson id). */
		bankUserId: bigint('bank_user_id', { mode: 'number' }).notNull(),
		/** The SHA-256 of the token in the address the bank calls (/api/bancos/bunq/<token>). */
		hookHash: text('hook_hash').notNull().unique(),
		/** Whether the bank calls that address (only with an https ORIGIN); else, only every hour. */
		hooked: boolean('hooked').notNull().default(false),
		/** What went wrong the last time it was asked, in Spanish; null, nothing. */
		problem: text('problem'),
		lastSyncAt: timestamp('last_sync_at'),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		userRows('bank_link_own', t.userId),
		pgPolicy('bank_link_by_hash', {
			for: 'select',
			using: sql`${t.hookHash} = nullif(current_setting('app.key_hash', true), '')`
		})
	]
).enableRLS();

/** Their accounts at the bank: those chosen bring their payments in. */
export const bankAccount = pgTable(
	'bank_account',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** The bank's id of the account. */
		accountId: bigint('account_id', { mode: 'number' }).notNull(),
		/** As the bank calls it («Principal», «Viajes»). */
		name: text('name').notNull(),
		iban: text('iban'),
		chosen: boolean('chosen').notNull().default(false),
		/** Closed at the bank: kept, as what it brought stays, but no longer offered. */
		closed: boolean('closed').notNull().default(false),
		/** The newest payment already looked at: only those after it are new. */
		lastPaymentId: bigint('last_payment_id', { mode: 'number' }),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.userId, t.accountId] }), userRows('bank_account_own', t.userId)]
).enableRLS();

/**
 * Each payment brought in, once: the expense it made or was joined to (a receipt already there,
 * a fixed one). Its expense deleted, the row stays with none, so that it does not come back.
 */
export const bankPayment = pgTable(
	'bank_payment',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		provider: text('provider').notNull(),
		/** The bank's id of the payment. */
		paymentId: bigint('payment_id', { mode: 'number' }).notNull(),
		/** Who brought it in: their connection. */
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		expenseId: integer('expense_id').references(() => expense.id, { onDelete: 'set null' }),
		/** Joined to an expense already there (`true`), or made one (`false`). */
		joined: boolean('joined').notNull().default(false),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		unique('bank_payment_once').on(t.familyId, t.provider, t.paymentId),
		index('bank_payment_expense_idx').on(t.expenseId),
		familyRows('bank_payment_own', t.familyId)
	]
).enableRLS();
