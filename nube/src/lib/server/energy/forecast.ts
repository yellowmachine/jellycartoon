import { and, asc, eq, gte, lt } from 'drizzle-orm';
import { addDays, localDay } from 'comun/agenda.ts';
import { billDays } from 'comun/bills.ts';
import { placeName, readWeather, type DayReading } from 'comun/weather.ts';
import { bill, plug, plugEnergy } from '../db/schema.ts';
import { familyPlace } from '../family-settings.ts';
import type { Kitchen } from '../fridge.ts';
import { kwhPriceIn } from '../plugs/plugs.ts';
import { dayStart } from '../plugs/stats.ts';
import { heatingDegrees } from '../weather-read.ts';
import { TIME_ZONE } from '#lib/plug-stats.ts';
import {
	expect,
	FORECAST_AHEAD,
	fitLine,
	MIN_BILLS,
	MIN_DAYS,
	type Expected,
	type Fit
} from '#lib/energy-forecast.ts';

/**
 * Energía → Previsión (#513, phase 1): the cold of the next FORECAST_AHEAD days (Open-Meteo, where
 * the family lives) and the light they will take, learned two ways: from the plugs day by day (only
 * what is plugged in), and from the light bills (the whole house, a figure a month).
 */

/** Days of plugs learned from, at most: the recent ones, as the house is now. */
const PLUG_DAYS = 60;
/** Bills learned from, at most: two years of them. */
const BILLS = 12;
/** A bill longer than this is not read for the weather (Open-Meteo, 92 days a call). */
const BILL_MAX_DAYS = 92;

/** The past does not change: its weather kept for each place and days, a few hundred of them. */
const pastKept = new Map<string, Promise<DayReading[] | null>>();
/** The next days change: kept half an hour. */
const nextKept = new Map<string, { at: number; days: Promise<DayReading[] | null> }>();

function past(lat: number, lon: number, from: string, to: string, today: string) {
	const key = `${lat.toFixed(3)},${lon.toFixed(3)},${from},${to}`;
	let found = pastKept.get(key);
	if (!found) {
		found = readWeather(lat, lon, from, to, today)
			.then((r) => r.days)
			.catch((error) => {
				console.warn('[previsión] Sin el tiempo pasado', String(error));
				pastKept.delete(key);
				return null;
			});
		if (pastKept.size > 500) pastKept.delete(pastKept.keys().next().value!);
		pastKept.set(key, found);
	}
	return found;
}

function next(lat: number, lon: number, today: string) {
	const key = `${lat.toFixed(3)},${lon.toFixed(3)},${today}`;
	const found = nextKept.get(key);
	if (found && Date.now() - found.at < 30 * 60_000) return found.days;
	const days = readWeather(lat, lon, today, addDays(today, FORECAST_AHEAD - 1), today)
		.then((r) => r.days)
		.catch((error) => {
			console.warn('[previsión] Sin la previsión', String(error));
			nextKept.delete(key);
			return null;
		});
	nextKept.set(key, { at: Date.now(), days });
	return days;
}

const dayOf = new Intl.DateTimeFormat('en-CA', {
	timeZone: TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});

export interface Learned {
	fit: Fit;
	expected: Expected;
	/** Euros at the price Energía uses; null without one. */
	euros: { kwh: number; low: number; high: number } | null;
}

/** What one way learned: its forecast, or how far from learning it is. */
export type Way = { learned: Learned } | { have: number; need: number } | null;

export interface EnergyForecast {
	place: string;
	days: { day: string; min: number; max: number; mean: number; degrees: number }[];
	/** Heating degree-days: the next days', and the same number of days just gone. */
	degrees: number;
	degreesBefore: number | null;
	plugs: Way;
	bills: Way;
}

/** The forecast; null without «Dónde vivís», a string if the weather could not be had. */
export async function energyForecast(k: Kitchen): Promise<EnergyForecast | string | null> {
	const place = await familyPlace(k);
	if (!place) return null;
	const today = localDay();
	const ahead = await next(place.lat, place.lon, today);
	if (!ahead?.length) return 'No se pudo saber la previsión del tiempo. Prueba dentro de un rato.';
	const days = ahead.map((d) => ({
		day: d.day,
		min: d.min,
		max: d.max,
		mean: d.mean,
		degrees: heatingDegrees(d.mean)
	}));
	const degreeDays = days.map((d) => d.degrees);
	const before = await past(
		place.lat,
		place.lon,
		addDays(today, -days.length),
		addDays(today, -1),
		today
	);

	const price = await kwhPriceIn(k);
	const withEuros = (fit: Fit): Learned => {
		const e = expect(fit, degreeDays);
		return {
			fit,
			expected: e,
			euros: price
				? { kwh: e.kwh * price.flat, low: e.low * price.flat, high: e.high * price.flat }
				: null
		};
	};
	const [plugs, bills] = await Promise.all([
		plugWay(k, place.lat, place.lon, today),
		billWay(k, place.lat, place.lon, today)
	]);
	return {
		place: place.name || placeName(place),
		days,
		degrees: degreeDays.reduce((s, d) => s + d, 0),
		degreesBefore: before?.length ? before.reduce((s, d) => s + heatingDegrees(d.mean), 0) : null,
		plugs: plugs && ('fit' in plugs ? { learned: withEuros(plugs.fit) } : plugs),
		bills: bills && ('fit' in bills ? { learned: withEuros(bills.fit) } : bills)
	};
}

type Learning = { fit: Fit } | { have: number; need: number } | null;

/** From the plugs: each whole day since the first was added (up to PLUG_DAYS), its kWh and cold. */
async function plugWay(k: Kitchen, lat: number, lon: number, today: string): Promise<Learning> {
	const [first] = await k.run((tx) =>
		tx.select({ createdAt: plug.createdAt }).from(plug).orderBy(asc(plug.createdAt)).limit(1)
	);
	if (!first) return null;
	const yesterday = addDays(today, -1);
	const from = [addDays(dayOf.format(first.createdAt), 1), addDays(today, -PLUG_DAYS)]
		.sort()
		.at(-1)!;
	if (from > yesterday) return { have: 0, need: MIN_DAYS };
	const rows = await k.run((tx) =>
		tx
			.select({ hour: plugEnergy.hour, wh: plugEnergy.wh })
			.from(plugEnergy)
			.where(and(gte(plugEnergy.hour, dayStart(from)), lt(plugEnergy.hour, dayStart(today))))
	);
	const kwh = new Map<string, number>();
	for (const r of rows) {
		const day = dayOf.format(r.hour);
		kwh.set(day, (kwh.get(day) ?? 0) + r.wh / 1000);
	}
	const known = Math.round((Date.parse(yesterday) - Date.parse(from)) / 86_400_000) + 1;
	if (known < MIN_DAYS) return { have: known, need: MIN_DAYS };
	const weather = await past(lat, lon, from, yesterday, today);
	if (!weather?.length) return { have: known, need: MIN_DAYS };
	const fit = fitLine(weather.map((d) => ({ x: heatingDegrees(d.mean), y: kwh.get(d.day) ?? 0 })));
	return fit ? { fit } : null;
}

/** From the light bills that say their kWh: each its kWh a day against its cold a day. */
async function billWay(k: Kitchen, lat: number, lon: number, today: string): Promise<Learning> {
	const rows = await k.run((tx) =>
		tx
			.select({
				start: bill.periodStart,
				end: bill.periodEnd,
				kwh: bill.consumption,
				unit: bill.unit
			})
			.from(bill)
			.where(and(eq(bill.kind, 'Luz'), gte(bill.periodStart, '2022-01-01')))
			.orderBy(asc(bill.periodEnd))
	);
	const usable = rows
		.filter(
			(r) =>
				r.kwh !== null &&
				r.kwh > 0 &&
				r.unit === 'kWh' &&
				r.end < today &&
				billDays({ periodStart: r.start, periodEnd: r.end }) <= BILL_MAX_DAYS
		)
		.slice(-BILLS);
	if (!rows.length) return null;
	if (usable.length < MIN_BILLS) return { have: usable.length, need: MIN_BILLS };
	const points = (
		await Promise.all(
			usable.map(async (r) => {
				const weather = await past(lat, lon, r.start, r.end, today);
				if (!weather?.length) return null;
				const n = billDays({ periodStart: r.start, periodEnd: r.end });
				const degrees = weather.reduce((s, d) => s + heatingDegrees(d.mean), 0);
				return { x: degrees / weather.length, y: r.kwh! / n, w: n };
			})
		)
	).filter((p) => p !== null);
	if (points.length < MIN_BILLS) return { have: points.length, need: MIN_BILLS };
	const fit = fitLine(points);
	return fit ? { fit } : null;
}
