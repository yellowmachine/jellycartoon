import { boolean, index, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import type { RuleSpec } from '#lib/rules.ts';
import { user } from './auth.schema.ts';
import { family, familyRows } from './family.schema.ts';

/**
 * The family's rules (#331, phase 2): «cuando vengan mis padres, si estoy de viaje, recuérdame que
 * les diga lo de las plantas», as said, as the AI understood it, and as data the server checks
 * itself (rules.ts). A person's, only theirs, as their memory; without a person, the whole house's.
 */
export const rule = pgTable(
	'rule',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		/** Whose; null, the house's (said on a satellite, or for everyone). */
		userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
		/** As said or written. */
		said: text('said').notNull(),
		/** As the AI understood it, to be read back: «Cuando empiece en la Agenda algo con…». */
		understood: text('understood').notNull(),
		spec: jsonb('spec').$type<RuleSpec>().notNull(),
		paused: boolean('paused').notNull().default(false),
		/** What it was told for already (an agenda event's day, a trip): not told again. */
		fired: jsonb('fired').$type<string[]>().notNull().default([]),
		lastFiredAt: timestamp('last_fired_at'),
		/** Why, the last time: «empieza «Vienen mis padres» y estás de viaje». */
		lastWhy: text('last_why'),
		/**
		 * What its words did not find, asked by its meaning (phase 3: the house's Ollama, or
		 * OpenRouter's if the family lets it): «agenda:llegan papa y mama» → whether it is, and why.
		 */
		matches: jsonb('matches')
			.$type<Record<string, { ok: boolean; why: string }>>()
			.notNull()
			.default({}),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		updatedAt: timestamp('updated_at').notNull().defaultNow()
	},
	(t) => [
		index('rule_family_user_idx').on(t.familyId, t.userId),
		familyRows('rule_own', t.familyId)
	]
).enableRLS();
