import { sql } from 'drizzle-orm';
import {
	boolean,
	index,
	pgPolicy,
	pgTable,
	primaryKey,
	real,
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
