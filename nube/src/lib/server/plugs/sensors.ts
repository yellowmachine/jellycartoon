import { and, asc, desc, gte, inArray } from 'drizzle-orm';
import { plug, plugReading } from '../db/schema.ts';
import type { AnyDb } from '../family-scope.ts';
import type { SensorView } from '#lib/temperature.ts';
import { isSensorDevice } from './shelly.ts';
import { SENSOR_SILENT_MS } from './watch.ts';

/**
 * The family's temperature sensors (#508), for Enchufes → Temperatura: each with its last reading
 * and its line for the chart since then, in Spain's hours as the chart writes them
 * (`YYYY-MM-DDTHH:MM`, as Open-Meteo's). Hourly, each hour's mean: a month of readings every 10
 * minutes is more than the chart can show.
 */

const TIME_ZONE = process.env.TZ || 'Europe/Madrid';
const local = new Intl.DateTimeFormat('sv-SE', {
	timeZone: TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23'
});
/** A moment in Spain's hours: `YYYY-MM-DDTHH:MM`. */
export const localAt = (at: Date) => local.format(at).replace(' ', 'T');

/** The chart's points from the readings (in order): each, or each hour's mean. */
export function pointsOf(readings: { at: Date; tempC: number | null }[], hourly: boolean) {
	if (!hourly)
		return readings.flatMap((r) =>
			r.tempC === null ? [] : [{ at: localAt(r.at), temperature: r.tempC }]
		);
	const hours = new Map<string, { sum: number; n: number }>();
	for (const r of readings) {
		if (r.tempC === null) continue;
		const hour = `${localAt(r.at).slice(0, 13)}:00`;
		const h = hours.get(hour) ?? { sum: 0, n: 0 };
		h.sum += r.tempC;
		h.n++;
		hours.set(hour, h);
	}
	return [...hours].map(([at, h]) => ({ at, temperature: Math.round((h.sum / h.n) * 10) / 10 }));
}

export async function sensorsIn(
	tx: AnyDb,
	since: Date,
	hourly: boolean,
	now = new Date()
): Promise<SensorView[]> {
	const sensors = (
		await tx
			.select({ id: plug.id, name: plug.name, deviceId: plug.deviceId, home: plug.home })
			.from(plug)
			.orderBy(asc(plug.createdAt))
	).filter((p) => isSensorDevice(p.deviceId));
	if (!sensors.length) return [];
	const ids = sensors.map((s) => s.id);
	const [last, readings] = await Promise.all([
		tx
			.selectDistinctOn([plugReading.plugId])
			.from(plugReading)
			.where(inArray(plugReading.plugId, ids))
			.orderBy(plugReading.plugId, desc(plugReading.at)),
		tx
			.select({ plugId: plugReading.plugId, at: plugReading.at, tempC: plugReading.tempC })
			.from(plugReading)
			.where(and(inArray(plugReading.plugId, ids), gte(plugReading.at, since)))
			.orderBy(asc(plugReading.at))
	]);
	return sensors.map((s) => {
		const l = last.find((r) => r.plugId === s.id);
		return {
			id: s.id,
			name: s.name,
			tempC: l?.tempC ?? null,
			humidity: l?.humidity ?? null,
			battery: l?.battery ?? null,
			external: l?.external ?? null,
			at: l?.at.toISOString() ?? null,
			silent: !!l && now.getTime() - l.at.getTime() > SENSOR_SILENT_MS,
			home: s.home || sensors.length === 1,
			points: pointsOf(
				readings.filter((r) => r.plugId === s.id),
				hourly
			)
		};
	});
}
