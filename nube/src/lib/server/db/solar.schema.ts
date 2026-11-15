import { date, integer, jsonb, pgTable, real, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { family, familyRows } from './family.schema.ts';
import type { PanelGroup } from '#lib/solar.ts';

/**
 * Energía → Previsión (#513, phase 3): the family's solar panels and battery, as the family says
 * them (no brand, no connection): enough to forecast what they make with the sun to come. One per
 * family.
 */
export const solar = pgTable(
	'solar',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.unique()
			.references(() => family.id, { onDelete: 'cascade' }),
		/** Panels facing each way: kWp, tilt and azimuth (Open-Meteo's: 0 south, −90 east). */
		groups: jsonb('groups').$type<PanelGroup[]>().notNull(),
		/** The inverter's most, kW; null, not said. */
		inverterKw: real('inverter_kw'),
		/** The battery, kWh; null, none. */
		batteryKwh: real('battery_kwh'),
		/** % of the battery kept and never used. */
		reserve: integer('reserve').notNull().default(10),
		/** What the whole house uses a day, kWh, as the family says (the inverter's app shows it). */
		dayKwh: real('day_kwh'),
		/** Since when they have them: the light bills before say what the whole house used. */
		installedOn: date('installed_on'),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [familyRows('solar_own', t.familyId)]
).enableRLS();
