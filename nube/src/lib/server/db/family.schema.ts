import { sql } from 'drizzle-orm';
import {
	boolean,
	index,
	jsonb,
	pgPolicy,
	pgTable,
	text,
	timestamp,
	uniqueIndex
} from 'drizzle-orm/pg-core';
import type { SubtitleStyle } from 'comun/subtitle-style.ts';
import { user } from './auth.schema.ts';

/**
 * Many families in one app (#253): every table of theirs has its `family_id`, and Postgres' own
 * row-level security keeps each to its own rows. The app enters as a role that is not the tables'
 * owner (scripts/init-db.sh), and `withFamily` (family.ts) says, for one transaction, who is asking
 * and from which family: without that, these tables give nothing. A filter forgotten in a query
 * cannot show another family's rows.
 */

/** Set by `withFamily` for its transaction only; empty outside one. */
export const currentFamily = sql`nullif(current_setting('app.family_id', true), '')`;
export const currentUser = sql`nullif(current_setting('app.user_id', true), '')`;

/** Set by `adminScope` (admin-scope.ts), for the service's administrator's counts in /admin. */
export const serviceAdmin = sql`current_setting('app.is_admin', true) = 'true'`;

/** What /admin counts of a table (admin-scope.ts): read only, every family's. */
export const adminReads = (name: string) => pgPolicy(name, { for: 'select', using: serviceAdmin });

/** A policy for all of a table's commands: only its family's rows, read or written. */
export const familyRows = (name: string, familyId: unknown) =>
	pgPolicy(name, {
		for: 'all',
		using: sql`${familyId} = ${currentFamily}`,
		withCheck: sql`${familyId} = ${currentFamily}`
	});

export const family = pgTable(
	'family',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [familyRows('family_own', t.id), adminReads('family_admin_reads')]
).enableRLS();

/**
 * Who is in which family: one each, for now. Its administrator manages its people and its house;
 * the service's administrator, who lets families in, is not one of these (scripts/crear-familia.ts).
 */
export const familyMember = pgTable(
	'family_member',
	{
		userId: text('user_id')
			.primaryKey()
			.references(() => user.id, { onDelete: 'cascade' }),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		role: text('role', { enum: ['admin', 'member', 'peque'] })
			.notNull()
			.default('member'),
		/** «Cómo quieres que te hable la voz», theirs; null, none. */
		voiceStyle: text('voice_style'),
		/** Their colours (Ajustes, comun/themes.ts); null or unknown, the default. */
		theme: text('theme'),
		/** «Guardar mis viajes» (Viajes): the road mode keeps where they went. */
		recordTrips: boolean('record_trips').notNull().default(false),
		/** «Mostrar el gasto en IA bajo la cabecera» (Ajustes, #193). */
		spendLine: boolean('spend_line').notNull().default(false),
		/** «Cómo te aviso» (Ajustes, #331): the messages left for them by email too. */
		inboxByEmail: boolean('inbox_by_email').notNull().default(false),
		/** How their subtitles look (Ajustes, comun/subtitle-style.ts); unset choices, the default. */
		subtitleStyle: jsonb('subtitle_style').$type<Partial<SubtitleStyle>>(),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		index('family_member_family_idx').on(t.familyId),
		familyRows('family_member_own', t.familyId),
		// One's own row, before knowing one's family: how `withFamily` finds it.
		pgPolicy('family_member_self', { for: 'select', using: sql`${t.userId} = ${currentUser}` })
	]
).enableRLS();

/**
 * The family's house (jellycartoon): where its APIs are reached from outside (MEDIA_HOST, through
 * the rathole tunnel) and the key it gave the cloud (Ajustes → Casa → «La nube»), kept encrypted
 * (secret-box.ts). Without one, a family uses only the cloud.
 */
export const house = pgTable(
	'house',
	{
		familyId: text('family_id')
			.primaryKey()
			.references(() => family.id, { onDelete: 'cascade' }),
		url: text('url').notNull(),
		key: text('key').notNull(),
		/**
		 * jellycartoon's own address (its ORIGIN), for the bar's sections that are the house's: only
		 * reached at home or through its VPN. Optional.
		 */
		webUrl: text('web_url'),
		updatedAt: timestamp('updated_at')
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date())
	},
	(t) => [familyRows('house_own', t.familyId), adminReads('house_admin_reads')]
).enableRLS();

/**
 * Who may sign up, and into which family: made by the service's administrator for a new family's
 * administrator (scripts/crear-familia.ts), and later by a family for its people. Without row-level
 * security: it is read while signing up, before anyone is anyone; only the server touches it.
 */
/**
 * An invitation: a link with its own token (which is all it takes to read it), for one email, that
 * lapses after 7 days (invitation.ts). Into a family, with a role; or, with no family, to make one's
 * own and administer it (a family let in from the waiting list, /admin/lista-de-espera). Read before
 * having a family, so no row-level security: only invitations.ts reaches it, by token or by family.
 */
export const invitation = pgTable(
	'invitation',
	{
		id: text('id').primaryKey(),
		email: text('email').notNull(),
		/** Opaque and unique: the link's `/invitacion/<token>`. A new one on sending it again. */
		token: text('token')
			.notNull()
			.unique()
			.default(sql`gen_random_uuid()::text`),
		/** None: a new family, theirs, named on accepting. */
		familyId: text('family_id').references(() => family.id, { onDelete: 'cascade' }),
		role: text('role', { enum: ['admin', 'member'] })
			.notNull()
			.default('member'),
		invitedBy: text('invited_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		expiresAt: timestamp('expires_at')
			.notNull()
			.default(sql`now() + interval '7 days'`),
		/** Accepted. */
		usedAt: timestamp('used_at'),
		cancelledAt: timestamp('cancelled_at')
	},
	(t) => [
		// One open invitation per email; a used or cancelled one does not stop another.
		uniqueIndex('invitation_open_email_idx')
			.on(sql`lower(${t.email})`)
			.where(sql`${t.usedAt} is null and ${t.cancelledAt} is null`)
	]
);

/**
 * The keys the family gives its house (jellycartoon), for it to write on the family's fridge and
 * read its recipes (its voice, its TV): made in Ajustes and pasted into jellycartoon. Only their
 * SHA-256 is kept. Found by it before knowing the family: Postgres shows the row whose hash the
 * request presented (`app.key_hash`, house-keys.ts), and otherwise only the family's own.
 */
export const houseKey = pgTable(
	'house_key',
	{
		id: text('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		hash: text('hash').notNull().unique(),
		/** How it starts, to tell one from another. */
		start: text('start').notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		lastUsedAt: timestamp('last_used_at')
	},
	(t) => [
		familyRows('house_key_own', t.familyId),
		pgPolicy('house_key_by_hash', {
			for: 'select',
			using: sql`${t.hash} = nullif(current_setting('app.key_hash', true), '')`
		})
	]
).enableRLS();
