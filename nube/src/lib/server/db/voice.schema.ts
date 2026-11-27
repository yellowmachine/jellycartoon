import { sql } from 'drizzle-orm';
import {
	boolean,
	index,
	integer,
	jsonb,
	pgPolicy,
	pgTable,
	serial,
	text,
	timestamp
} from 'drizzle-orm/pg-core';
import type { SatelliteRule } from 'comun/plug-rules.ts';

/** As offered to a satellite (#651): its version, the rules, and who signed them. */
export interface OfferedPlugRules {
	version: number;
	rules: SatelliteRule[];
	envelope?: string;
	sig?: string;
}
import { family, familyRows } from './family.schema.ts';

/**
 * What the voice has learned from its own questions: «media hora», asked on the bedroom's
 * satellite, was a timer. Each by its place (a satellite, a person), written by the AI as a rule
 * for the next time, with the words that would bring it up (voice/learned.ts).
 */
export const voiceLearned = pgTable(
	'voice_learned',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		/** «satelite:<id>» or «user:<id>», as `AlarmPlace` and the «horas de silencio» say it. */
		place: text('place').notNull(),
		/** Its name when it was learned, for Ajustes: «satelite dormitorio», «Miguel». */
		placeName: text('place_name').notNull(),
		/** «Una duración sola es un temporizador». */
		title: text('title').notNull(),
		/** What the AI is told: «Si dice solo una duración ("media hora"), pon un temporizador». */
		rule: text('rule').notNull(),
		/** Folded, that a later order would have: «media», «hora», «minutos». */
		words: jsonb('words').$type<string[]>().notNull(),
		/** Times done by it and not corrected: those first, when there are many. */
		hits: integer('hits').notNull().default(0),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		updatedAt: timestamp('updated_at').notNull().defaultNow()
	},
	(t) => [
		index('voice_learned_place_idx').on(t.familyId, t.place),
		familyRows('voice_learned_own', t.familyId)
	]
).enableRLS();

/**
 * The voice satellites Seilide serves (#296): a Raspberry in a room, with its key, for families
 * with or without jellycartoon. Its id is its place's (`satelite:<id>`: its alarms, what it learned).
 */
export const voiceSatellite = pgTable(
	'voice_satellite',
	{
		id: text('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		/** As it is said: «dormitorio». */
		name: text('name').notNull(),
		/** Its key's SHA-256: the key itself is shown once. */
		hash: text('hash').notNull().unique(),
		/** How it starts, to tell one from another. */
		start: text('start').notNull(),
		/**
		 * The house's snapserver it plays from, «192.168.1.20» or «casa.local:1704», told to it live
		 * (its own snapclient, restarted when it changes); null, no music there.
		 */
		snapserver: text('snapserver'),
		/**
		 * «Modo conversación» (#361): after any answer it listens a few seconds without the wake
		 * word. Off: with a TV in the room it would take the TV's words for orders.
		 */
		conversation: boolean('conversation').notNull().default(false),
		/**
		 * The languages it is spoken to in (#647, satellite-language.ts): one, given to the speech
		 * to text; several, found out.
		 */
		languages: jsonb('languages').$type<string[]>().notNull().default(['es']),
		/** The one it answers in, among them; `auto`, as it is spoken to. */
		answerLanguage: text('answer_language').notNull().default('es'),
		/** Its own key's fingerprint (#643), as its beat says: its plugs say it too. */
		trustFp: text('trust_fp'),
		/**
		 * The plug rules offered to it (#651): the list, and a device's signature (none, said to it);
		 * it takes them only signed, or right after it heard an order. Null, none yet.
		 */
		plugRules: jsonb('plug_rules').$type<OfferedPlugRules>(),
		/** The version of them it says it keeps, in its beat: 0, none. */
		plugRulesKept: integer('plug_rules_kept').notNull().default(0),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		lastSeenAt: timestamp('last_seen_at')
	},
	(t) => [
		familyRows('voice_satellite_own', t.familyId),
		pgPolicy('voice_satellite_by_hash', {
			for: 'select',
			using: sql`${t.hash} = nullif(current_setting('app.key_hash', true), '')`
		})
	]
).enableRLS();
