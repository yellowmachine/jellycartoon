import { sql } from 'drizzle-orm';
import {
	boolean,
	index,
	integer,
	pgPolicy,
	pgTable,
	primaryKey,
	real,
	serial,
	text,
	timestamp
} from 'drizzle-orm/pg-core';
import { family, familyRows } from './family.schema.ts';

/**
 * Smart plugs (#396): Shelly Gen2+ plugs that connect by themselves to Seilide through their
 * outbound WebSocket (`wss://…/api/enchufe/<token>`), so nothing is installed at home. Each is known
 * by its token, kept only as its SHA-256, as the satellites' keys.
 */
export const plug = pgTable(
	'plug',
	{
		id: text('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		/** As the family calls it: «Lámpara del salón». */
		name: text('name').notNull(),
		/** What is plugged in (#396): its icon, and the termo's advice. */
		kind: text('kind', {
			enum: ['lampara', 'lavadora', 'termo', 'nevera', 'tele', 'otro']
		}).notNull(),
		/** Its token's SHA-256: the token itself is shown once, inside the address. */
		hash: text('hash').notNull().unique(),
		/** The Shelly's own id («shellyplugmg3-9070696e4874»), once it has connected. */
		deviceId: text('device_id'),
		/** Its model («S3PL-30110EU»), once it has connected. */
		model: text('model'),
		/** On or off, as last told; null, never connected. */
		output: boolean('output'),
		/** Watts, as last told. */
		power: real('power'),
		/** Its own energy counter, in Wh, as last told: what each hour used comes from its rise. */
		energyWh: real('energy_wh'),
		/**
		 * «En pausa» (#396, a water heater in summer): off, and its schedules off; since when. A long
		 * pause ends with a long heat, against legionella.
		 */
		paused: boolean('paused').notNull().default(false),
		pausedAt: timestamp('paused_at'),
		/** That long heat, on until then; null, none. */
		heatUntil: timestamp('heat_until'),
		/**
		 * Its notices (#396, phase 3), set by its kind when added: a washing machine done, a fridge
		 * stopped, gone without connection (the power or the wifi), on longer than these hours (null,
		 * never); and said out loud by the satellites too.
		 */
		notifyDone: boolean('notify_done').notNull().default(false),
		notifyStopped: boolean('notify_stopped').notNull().default(false),
		notifyOffline: boolean('notify_offline').notNull().default(false),
		notifyOnHours: integer('notify_on_hours'),
		notifyAloud: boolean('notify_aloud').notNull().default(false),
		/** The ids of the plug's own schedule jobs that are Seilide's: only these it rewrites. */
		scheduleJobs: integer('schedule_jobs')
			.array()
			.notNull()
			.default(sql`'{}'`),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		lastSeenAt: timestamp('last_seen_at')
	},
	(t) => [
		familyRows('plug_own', t.familyId),
		pgPolicy('plug_by_hash', {
			for: 'select',
			using: sql`${t.hash} = nullif(current_setting('app.key_hash', true), '')`
		})
	]
).enableRLS();

/** What each plug used, hour by hour (the hour's start), in Wh: today's, the month's. */
export const plugEnergy = pgTable(
	'plug_energy',
	{
		plugId: text('plug_id')
			.notNull()
			.references(() => plug.id, { onDelete: 'cascade' }),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		hour: timestamp('hour').notNull(),
		wh: real('wh').notNull().default(0)
	},
	(t) => [
		primaryKey({ columns: [t.plugId, t.hour] }),
		index('plug_energy_family_hour_idx').on(t.familyId, t.hour),
		familyRows('plug_energy_own', t.familyId)
	]
).enableRLS();

/**
 * When each plug goes on and off by itself (#396): on these days (0 Sunday … 6 Saturday, as the
 * plug's cron), from `start` to `end` («HH:MM»); ending before it starts, the next day. Written to
 * the plug as its own schedule jobs, so it keeps them without Seilide or internet.
 */
export const plugSchedule = pgTable(
	'plug_schedule',
	{
		id: serial('id').primaryKey(),
		plugId: text('plug_id')
			.notNull()
			.references(() => plug.id, { onDelete: 'cascade' }),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		days: integer('days').array().notNull(),
		start: text('start').notNull(),
		end: text('end').notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [index('plug_schedule_plug_idx').on(t.plugId), familyRows('plug_schedule_own', t.familyId)]
).enableRLS();
