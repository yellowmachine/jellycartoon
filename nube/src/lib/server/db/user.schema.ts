import { sql } from 'drizzle-orm';
import { pgPolicy, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth.schema.ts';
import { currentUser } from './family.schema.ts';

/**
 * What is a person's and of no family (#428): it goes with them when they leave or join one, with
 * nothing to do. Postgres shows only one's own rows, by `app.user_id` (`asUser`, family-scope.ts).
 */

/** A policy for all of a table's commands: only this person's rows, read or written. */
const userRows = (name: string, userId: unknown) =>
	pgPolicy(name, {
		for: 'all',
		using: sql`${userId} = ${currentUser}`,
		withCheck: sql`${userId} = ${currentUser}`
	});

/**
 * Each person's data key: the key their secrets are encrypted with (user-secret-scope.ts), kept only
 * wrapped by the KMS, bound to them, as `family_data_key` is to a family. Made the first time a
 * secret of theirs is kept with the KMS on; without the KMS, none.
 */
export const userDataKey = pgTable(
	'user_data_key',
	{
		userId: text('user_id')
			.primaryKey()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** As the KMS gave it back: its ciphertext. */
		wrapped: text('wrapped').notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [userRows('user_data_key_own', t.userId)]
).enableRLS();

/** A person's secrets, by name, encrypted (user-secret-scope.ts): never the secret itself. */
export const userSecret = pgTable(
	'user_secret',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		value: text('value').notNull(),
		updatedAt: timestamp('updated_at')
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date())
	},
	(t) => [primaryKey({ columns: [t.userId, t.name] }), userRows('user_secret_own', t.userId)]
).enableRLS();

/** Their Miniflux (Noticias, #428): its address. Its API key, a secret of theirs. */
export const minifluxLink = pgTable(
	'miniflux_link',
	{
		userId: text('user_id')
			.primaryKey()
			.references(() => user.id, { onDelete: 'cascade' }),
		url: text('url').notNull(),
		updatedAt: timestamp('updated_at')
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date())
	},
	(t) => [userRows('miniflux_link_own', t.userId)]
).enableRLS();
