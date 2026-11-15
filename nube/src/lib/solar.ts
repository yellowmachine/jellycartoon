import { DAY_SHAPE } from './day-shape.ts';

/**
 * Solar panels and battery (Energía → Previsión, #513 phase 3): from the sun Open-Meteo forecasts on
 * the panels, what they will make each hour of the next days; from what the house uses a day,
 * spread over the hours as a Spanish home does (day-shape.ts), what goes into the battery, what is
 * left over for the grid and what is taken from it. Brand-free: only what the family says of its
 * panels.
 */

/** Panels facing one way: a roof with two sides is two groups. */
export interface PanelGroup {
	kwp: number;
	/** Degrees: 0 flat, 90 upright. */
	tilt: number;
	/** As Open-Meteo: 0 south, −90 east, 90 west, 180 north. */
	azimuth: number;
}

export const MAX_GROUPS = 3;

/** The ways a group can face, for the family to choose. */
export const FACINGS = [
	{ azimuth: 0, name: 'Sur' },
	{ azimuth: -45, name: 'Sureste' },
	{ azimuth: 45, name: 'Suroeste' },
	{ azimuth: -90, name: 'Este' },
	{ azimuth: 90, name: 'Oeste' },
	{ azimuth: -135, name: 'Noreste' },
	{ azimuth: 135, name: 'Noroeste' },
	{ azimuth: 180, name: 'Norte' }
] as const;
export const facingName = (azimuth: number) =>
	FACINGS.find((f) => f.azimuth === azimuth)?.name ?? `${azimuth}°`;

/**
 * Of the sun on the panels, what reaches the house: heat, the inverter, wires and dirt take about a
 * fifth (the usual «performance ratio» of a home installation). To be learned from real data later.
 */
export const PERFORMANCE = 0.8;
/** Of what goes into the battery, what comes out. */
const BATTERY_ROUND_TRIP = 0.9;
/** kW left over that are worth a washing machine or the water heater (about 1 to 2 kW). */
export const SPARE_KW = 1;

export interface SolarSetup {
	groups: PanelGroup[];
	/** The inverter's most, kW: more sun than that is lost. Null, not said. */
	inverterKw: number | null;
	/** The battery, kWh; null, none. */
	batteryKwh: number | null;
	/** % of the battery kept and never used (most keep 10 %). */
	reserve: number;
}

/** One hour: its day and the hour it starts, Spain's time. */
export interface Hour {
	day: string;
	hour: number;
}

export interface SolarHour extends Hour {
	/** kWh, that hour. */
	made: number;
	used: number;
	fromGrid: number;
	toGrid: number;
	/** kWh in the battery at its end, above the reserve. */
	stored: number;
}

export interface SolarDay {
	day: string;
	made: number;
	used: number;
	fromGrid: number;
	toGrid: number;
	/** With a battery: it got full that day. */
	full: boolean;
	/**
	 * With a battery: the hour it ran out at after the sun went (up to the next morning's sun),
	 * null if it lasted; without one, always null.
	 */
	emptyAt: number | null;
	/** The longest run of hours with SPARE_KW or more left over for the grid: a good time for appliances. */
	spare: { from: number; to: number; kwh: number } | null;
}

/** kWh the panels make in an hour with `wm2` of sun on each group (in the same order). */
export function madeIn(setup: SolarSetup, wm2: number[]) {
	const kw = setup.groups.reduce((s, g, i) => s + (g.kwp * (wm2[i] ?? 0) * PERFORMANCE) / 1000, 0);
	return setup.inverterKw ? Math.min(kw, setup.inverterKw) : kw;
}

/** What the house uses in that hour, of `dayKwh` that day, as a Spanish home spreads it. */
export function usedIn(h: Hour, dayKwh: number) {
	const month = Number(h.day.slice(5, 7)) - 1;
	return dayKwh * (DAY_SHAPE[month]?.[h.hour] ?? 1 / 24);
}

/**
 * Hour by hour, in order, with what each makes and uses: the battery takes what is left over and
 * gives what is missing; past its full or empty, the grid. How full the battery is now is not
 * known: as at the end of a day like the first one (that day run once to find out).
 */
export function runSolar(
	setup: SolarSetup,
	hours: (Hour & { made: number; used: number })[]
): SolarHour[] {
	const room = setup.batteryKwh ? setup.batteryKwh * (1 - setup.reserve / 100) : 0;
	const pass = (list: typeof hours, start: number) => {
		let stored = start;
		return list.map((h): SolarHour => {
			let net = h.made - h.used;
			if (net > 0) {
				const into = Math.min(net, (room - stored) / BATTERY_ROUND_TRIP);
				stored += into * BATTERY_ROUND_TRIP;
				net -= into;
				return { ...h, fromGrid: 0, toGrid: net, stored };
			}
			const out = Math.min(-net, stored);
			stored -= out;
			return { ...h, fromGrid: -net - out, toGrid: 0, stored };
		});
	};
	const first = hours.filter((h) => h.day === hours[0]?.day);
	const warm = pass(first, room / 2).at(-1)?.stored ?? 0;
	return pass(hours, warm);
}

/** The hours summed by day, with when the battery ran out and the best time for appliances. */
export function solarDays(setup: SolarSetup, hours: SolarHour[]): SolarDay[] {
	const room = setup.batteryKwh ? setup.batteryKwh * (1 - setup.reserve / 100) : 0;
	const days: SolarDay[] = [];
	const byDay = new Map<string, SolarHour[]>();
	for (const h of hours) byDay.set(h.day, [...(byDay.get(h.day) ?? []), h]);
	const list = [...byDay.entries()];
	list.forEach(([day, hs], i) => {
		const sum = (f: (h: SolarHour) => number) => hs.reduce((s, h) => s + f(h), 0);
		let emptyAt: number | null = null;
		if (room > 0) {
			// After this day's last sun, and the next morning until its first.
			const lastSun = hs.findLastIndex((h) => h.made > 0);
			const next = list[i + 1]?.[1] ?? [];
			const firstSun = next.findIndex((h) => h.made > 0);
			const night = [
				...hs.slice(lastSun + 1),
				...next.slice(0, firstSun < 0 ? next.length : firstSun)
			];
			emptyAt = night.find((h) => h.fromGrid > 0.01)?.hour ?? null;
		}
		let best: SolarDay['spare'] = null;
		let run: SolarHour[] = [];
		for (const h of [...hs, null]) {
			if (h && h.toGrid >= SPARE_KW) {
				run.push(h);
				continue;
			}
			if (run.length) {
				const kwh = run.reduce((s, r) => s + r.toGrid, 0);
				if (!best || kwh > best.kwh) best = { from: run[0]!.hour, to: run.at(-1)!.hour + 1, kwh };
			}
			run = [];
		}
		days.push({
			day,
			made: sum((h) => h.made),
			used: sum((h) => h.used),
			fromGrid: sum((h) => h.fromGrid),
			toGrid: sum((h) => h.toGrid),
			full: room > 0 && hs.some((h) => h.stored >= room - 0.01),
			emptyAt,
			spare: best
		});
	});
	return days;
}
