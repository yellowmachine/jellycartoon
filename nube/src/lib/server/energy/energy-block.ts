import { and, gte, lte, lt } from 'drizzle-orm';
import { addDays, localDay } from 'comun/agenda.ts';
import { placeName } from 'comun/weather.ts';
import { fuel, fuelUnit, plug, plugEnergy } from '../db/schema.ts';
import { familyPlace } from '../family-settings.ts';
import type { Kitchen } from '../fridge.ts';
import { kwhPriceIn } from '../plugs/plugs.ts';
import { dayStart } from '../plugs/stats.ts';
import { heatingDegrees } from '../weather-read.ts';
import { pastDays } from './forecast.ts';
import { TIME_ZONE } from '#lib/plug-stats.ts';
import type { EnergyBlock } from '#lib/reports.ts';

/**
 * Informes' «energia» block (#513 phase 4): the house's energy over a report's days, up to
 * yesterday: what the plugs used each day (Spain's days, as Consumo), the cold of each (heating
 * degree-days where the family lives), and the butane bottles or pellet sacks started. To see a
 * fortnight's light against its cold, or what a cold spell took.
 */

const dayOf = new Intl.DateTimeFormat('en-CA', {
	timeZone: TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});

export async function energyBlock(
	k: Kitchen,
	from: string,
	to: string
): Promise<EnergyBlock | string> {
	const today = localDay();
	const last = [to, addDays(today, -1)].sort()[0]!;
	if (from > last) return 'Esos días aún no han pasado.';
	const [plugs, kinds, started, rows, place, price] = await Promise.all([
		k.run((tx) => tx.select({ id: plug.id }).from(plug).limit(1)),
		k.run((tx) => tx.select({ id: fuel.id, kind: fuel.kind }).from(fuel)),
		k.run((tx) =>
			tx
				.select({ fuelId: fuelUnit.fuelId })
				.from(fuelUnit)
				.where(and(gte(fuelUnit.startedOn, from), lte(fuelUnit.startedOn, last)))
		),
		k.run((tx) =>
			tx
				.select({ hour: plugEnergy.hour, wh: plugEnergy.wh })
				.from(plugEnergy)
				.where(
					and(gte(plugEnergy.hour, dayStart(from)), lt(plugEnergy.hour, dayStart(addDays(last, 1))))
				)
		),
		familyPlace(k),
		kwhPriceIn(k)
	]);
	const kwh = new Map<string, number>();
	for (const r of rows) {
		const day = dayOf.format(r.hour);
		kwh.set(day, (kwh.get(day) ?? 0) + r.wh / 1000);
	}
	const weather = place ? await pastDays(place.lat, place.lon, from, last, today) : null;
	const degrees = new Map((weather ?? []).map((d) => [d.day, heatingDegrees(d.mean)]));
	const fuels = kinds
		.map((f) => ({ kind: f.kind, units: started.filter((s) => s.fuelId === f.id).length }))
		.filter((f) => f.units > 0);
	if (!plugs.length && !kinds.length)
		return 'La familia no tiene enchufes ni butano o pellet en Energía.';
	const days: EnergyBlock['days'] = [];
	for (let day = from; day <= last; day = addDays(day, 1))
		days.push({
			day,
			kwh: plugs.length ? Math.round((kwh.get(day) ?? 0) * 100) / 100 : null,
			degrees: degrees.has(day) ? Math.round(degrees.get(day)! * 10) / 10 : null
		});
	return {
		kind: 'energia',
		place: place ? place.name || placeName(place) : null,
		days,
		price: price?.flat ?? null,
		fuels
	};
}
