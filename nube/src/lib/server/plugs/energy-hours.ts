import { periodAt, type PeriodName } from '#lib/kwh-price.ts';
import { TIME_ZONE } from '#lib/plug-stats.ts';

/**
 * A plug's hours for Preguntar: hour by hour, the usual day, and what it uses at rest (an office
 * computer suspended, a tele in standby). The sums are done here; the AI only explains them.
 */

const HOUR_MS = 3_600_000;

/** One plug's use by the hour's start (ms); an hour without it has no row. */
export type HourlyWh = Map<number, number>;

const partsFormat = new Intl.DateTimeFormat('en-GB', {
	timeZone: TIME_ZONE,
	weekday: 'short',
	hour: '2-digit',
	hourCycle: 'h23'
});

/** An instant's local hour, and whether its day is Saturday or Sunday. */
function localHour(ms: number) {
	const p = Object.fromEntries(partsFormat.formatToParts(ms).map((x) => [x.type, x.value]));
	return { hour: Number(p.hour), weekend: p.weekday === 'Sat' || p.weekday === 'Sun' };
}

const whText = (wh: number) =>
	wh.toLocaleString('es-ES', { maximumFractionDigits: wh < 10 ? 1 : 0 });
const hourName = (hour: number) => `${String(hour).padStart(2, '0')}h`;

/** The hours' starts in [from, until). */
export function hoursBetween(from: number, until: number) {
	const hours: number[] = [];
	for (let h = Math.ceil(from / HOUR_MS) * HOUR_MS; h < until; h += HOUR_MS) hours.push(h);
	return hours;
}

/** «00h 4,2 · 01h 4 · 02h –»: those hours' Wh; «–», nothing registered. */
export function hoursText(rows: HourlyWh, hours: number[]) {
	return hours
		.map((h) => {
			const wh = rows.get(h);
			return `${hourName(localHour(h).hour)} ${wh ? whText(wh) : '–'}`;
		})
		.join(' · ');
}

/** The usual day: each hour's average, working days and weekends apart; nothing registered is 0. */
export function profileText(rows: HourlyWh, hours: number[]) {
	const sums = [0, 1].map(() => Array.from({ length: 24 }, () => ({ wh: 0, n: 0 })));
	for (const h of hours) {
		const { hour, weekend } = localHour(h);
		const s = sums[weekend ? 1 : 0]![hour]!;
		s.wh += rows.get(h) ?? 0;
		s.n++;
	}
	return ['de lunes a viernes', 'fin de semana'].flatMap((label, i) => {
		const day = sums[i]!;
		if (!day.some((s) => s.n)) return [];
		return [
			`${label}: ${day.flatMap((s, hour) => (s.n ? [`${hourName(hour)} ${whText(s.wh / s.n)}`] : [])).join(' · ')}`
		];
	});
}

export interface Rest {
	/** Its average watts in its lowest hours. */
	watts: number;
	/** How many hours were that low, and their Wh. */
	hours: number;
	wh: number;
	/** The whole hours it was worked out from. */
	of: number;
}

/** With fewer whole hours than these, nothing is said of it at rest. */
const MIN_HOURS = 6;

/**
 * What it uses at rest: the average of its lowest hours (up to half as much again, and 1 Wh more,
 * as its 10th percentile). Only hours with a registered one at each side: next to a gap they may
 * be partial, or carry what a plug without connection had saved up. Null, not enough of them.
 */
export function restOf(rows: HourlyWh, hours: number[]): Rest | null {
	const whole = hours
		.filter((h) => rows.get(h) && rows.get(h - HOUR_MS) && rows.get(h + HOUR_MS))
		.map((h) => rows.get(h)!)
		.sort((a, b) => a - b);
	if (whole.length < MIN_HOURS) return null;
	const low = whole[Math.floor((whole.length - 1) * 0.1)]!;
	const lowest = whole.filter((wh) => wh <= low * 1.5 + 1);
	const wh = lowest.reduce((sum, v) => sum + v, 0);
	return { watts: wh / lowest.length, hours: lowest.length, wh, of: whole.length };
}

/** What was used in each period of the 2.0TD tariff. */
export function byPeriod(rows: HourlyWh) {
	const sums: Record<PeriodName, number> = { P1: 0, P2: 0, P3: 0 };
	for (const [h, wh] of rows) sums[periodAt(new Date(h))] += wh;
	return sums;
}

/** «4,2 W»: watts with a decimal when few, where they matter. */
export const wattsText = (w: number) => `${whText(w)} W`;
