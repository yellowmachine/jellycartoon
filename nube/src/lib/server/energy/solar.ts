import { eq } from 'drizzle-orm';
import { addDays, localDay } from 'comun/agenda.ts';
import { sunOnPanels, type SunHour } from 'comun/weather.ts';
import { solar } from '../db/schema.ts';
import { familyPlace } from '../family-settings.ts';
import type { Kitchen } from '../fridge.ts';
import { kwhPriceIn } from '../plugs/plugs.ts';
import { heatingDegrees } from '../weather-read.ts';
import { billWay, nextDays } from './forecast.ts';
import {
	madeIn,
	MAX_GROUPS,
	runSolar,
	solarDays,
	usedIn,
	type PanelGroup,
	type SolarDay,
	type SolarSetup
} from '#lib/solar.ts';
import { FORECAST_AHEAD, MIN_BILLS, type Fit } from '#lib/energy-forecast.ts';

/**
 * Solar panels and battery (Energía → Previsión, #513 phase 3), brand-free: what the family says of
 * them and the sun Open-Meteo forecasts on them. What the whole house uses a day, from what the
 * family says or the light bills from before the panels (after, they only say what came from the
 * grid).
 */

export type SolarRow = typeof solar.$inferSelect;

/** The sun on each way the panels face, kept half an hour (it is a forecast). */
const sunKept = new Map<string, { at: number; hours: Promise<SunHour[] | null> }>();

function sunOn(lat: number, lon: number, g: PanelGroup, today: string) {
	const key = `${lat.toFixed(3)},${lon.toFixed(3)},${g.tilt},${g.azimuth},${today}`;
	const found = sunKept.get(key);
	if (found && Date.now() - found.at < 30 * 60_000) return found.hours;
	const hours = sunOnPanels(lat, lon, g.tilt, g.azimuth, today).catch((error) => {
		console.warn('[placas] Sin el sol previsto', String(error));
		sunKept.delete(key);
		return null;
	});
	if (sunKept.size > 200) sunKept.delete(sunKept.keys().next().value!);
	sunKept.set(key, { at: Date.now(), hours });
	return hours;
}

export interface SolarState {
	row: SolarRow;
	/** Null without «Dónde vivís»; a string when the forecast could not be had. */
	forecast: SolarForecast | string | null;
}

export interface SolarForecast {
	days: SolarDay[];
	/** What the house uses a day was taken from. */
	use:
		| { by: 'dicho'; kwh: number }
		| { by: 'facturas'; fit: Fit }
		| { by: null; bills: { have: number; need: number } | null };
	/** € a kWh from the grid, at the price Energía uses; null without one. */
	price: number | null;
}

/** The family's panels and their forecast; null, none. */
export async function solarState(k: Kitchen): Promise<SolarState | null> {
	const [row] = await k.run((tx) => tx.select().from(solar).limit(1));
	if (!row) return null;
	const place = await familyPlace(k);
	if (!place) return { row, forecast: null };
	const today = localDay();

	let use: SolarForecast['use'] = { by: null, bills: null };
	let dayKwh: ((day: string) => number) | null = null;
	const degrees = new Map<string, number>();
	if (row.dayKwh) {
		use = { by: 'dicho', kwh: row.dayKwh };
		dayKwh = () => row.dayKwh!;
	} else if (row.installedOn) {
		const learned = await billWay(k, place.lat, place.lon, today, row.installedOn);
		if (learned && 'fit' in learned) {
			const fit = learned.fit;
			use = { by: 'facturas', fit };
			for (const d of (await nextDays(place.lat, place.lon, today)) ?? [])
				degrees.set(d.day, heatingDegrees(d.mean));
			dayKwh = (day) => fit.base + fit.perDegree * (degrees.get(day) ?? 0);
		} else use = { by: null, bills: learned ?? { have: 0, need: MIN_BILLS } };
	}
	if (!dayKwh) return { row, forecast: { days: [], use, price: null } };

	const suns = await Promise.all(row.groups.map((g) => sunOn(place.lat, place.lon, g, today)));
	if (suns.some((s) => !s?.length))
		return { row, forecast: 'No se pudo saber el sol previsto. Prueba dentro de un rato.' };
	const setup = setupOf(row);
	const at = suns.map((s) => new Map(s!.map((h) => [`${h.day} ${h.hour}`, h.wm2])));
	const last = addDays(today, FORECAST_AHEAD - 1);
	const hours = suns[0]!
		.filter((h) => h.day <= last)
		.map((h) => {
			const key = `${h.day} ${h.hour}`;
			return {
				day: h.day,
				hour: h.hour,
				made: madeIn(
					setup,
					at.map((m) => m.get(key) ?? 0)
				),
				used: usedIn(h, Math.max(0, dayKwh(h.day)))
			};
		});
	const price = await kwhPriceIn(k);
	return {
		row,
		forecast: { days: solarDays(setup, runSolar(setup, hours)), use, price: price?.flat ?? null }
	};
}

export const setupOf = (row: SolarRow): SolarSetup => ({
	groups: row.groups,
	inverterKw: row.inverterKw,
	batteryKwh: row.batteryKwh,
	reserve: row.reserve
});

/** Panels added with what most homes have, to be changed: 4 kWp facing south at 30°. */
export async function addSolar(k: Kitchen) {
	await k.run((tx) =>
		tx
			.insert(solar)
			.values({ familyId: k.familyId, groups: [{ kwp: 4, tilt: 30, azimuth: 0 }] })
			.onConflictDoNothing()
	);
}

export async function removeSolar(k: Kitchen) {
	await k.run((tx) => tx.delete(solar).where(eq(solar.familyId, k.familyId)));
}

export interface SolarInput {
	groups: PanelGroup[];
	inverterKw: number | null;
	batteryKwh: number | null;
	reserve: number;
	dayKwh: number | null;
	installedOn: string | null;
}

/** What the form says, or why not. */
export function solarInput(form: FormData, today: string): SolarInput | string {
	const num = (name: string) => {
		const v = String(form.get(name) ?? '')
			.trim()
			.replace(',', '.');
		return v === '' ? null : Number(v);
	};
	const groups: PanelGroup[] = [];
	for (let i = 0; i < MAX_GROUPS; i++) {
		const kwp = num(`kwp${i}`);
		if (kwp === null || kwp === 0) continue;
		const tilt = num(`tilt${i}`) ?? 30;
		const azimuth = num(`azimuth${i}`) ?? 0;
		if (!(kwp > 0 && kwp <= 100)) return 'Los kWp de los paneles: entre 0 y 100';
		if (!(tilt >= 0 && tilt <= 90)) return 'La inclinación: de 0 (planos) a 90 (de pie)';
		if (!(azimuth >= -180 && azimuth <= 180)) return 'No sé hacia dónde miran';
		groups.push({ kwp, tilt, azimuth });
	}
	if (!groups.length) return 'Pon los kWp de los paneles';
	const inverterKw = num('inverterKw');
	const batteryKwh = num('batteryKwh');
	const reserve = num('reserve') ?? 10;
	const dayKwh = num('dayKwh');
	const installedOn = String(form.get('installedOn') ?? '') || null;
	for (const [v, what] of [
		[inverterKw, 'El inversor'],
		[batteryKwh, 'La batería'],
		[dayKwh, 'Lo que gasta la casa']
	] as const)
		if (v !== null && !(v >= 0 && v <= 200)) return `${what}: un número entre 0 y 200`;
	if (!(reserve >= 0 && reserve <= 90)) return 'La reserva de la batería: de 0 a 90 %';
	if (installedOn && !(/^\d{4}-\d{2}-\d{2}$/.test(installedOn) && installedOn <= today))
		return 'El día de las placas no vale';
	return {
		groups,
		inverterKw: inverterKw || null,
		batteryKwh: batteryKwh || null,
		reserve,
		dayKwh: dayKwh || null,
		installedOn
	};
}

export async function saveSolar(k: Kitchen, input: SolarInput) {
	await k.run((tx) => tx.update(solar).set(input).where(eq(solar.familyId, k.familyId)));
}
