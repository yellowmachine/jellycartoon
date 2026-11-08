import type { KwhPrice, PeriodName } from './kwh-price.ts';

/**
 * Enchufes → Consumo (#396): the views and their periods, in local days (`YYYY-MM-DD`), for the
 * server (stats.ts) and the page. Weeks start on Monday.
 */

export const STATS_VIEWS = ['dia', 'semana', 'mes', 'año'] as const;
export type StatsView = (typeof STATS_VIEWS)[number];
export const VIEW_LABELS: Record<StatsView, string> = {
	dia: 'Día',
	semana: 'Semana',
	mes: 'Mes',
	año: 'Año'
};

export const TIME_ZONE = 'Europe/Madrid';

export interface StatsBucket {
	key: string;
	/** In full, for its tooltip and the table: «lunes 2», «6:00 a 7:00». */
	label: string;
	/** Under its column, when there is room: «L 2», «6 h». */
	tick: string | null;
	wh: number;
	/** At today's price; null without one. */
	euros: number | null;
}

export interface PlugStats {
	view: StatsView;
	/** The day asked for, and today. */
	day: string;
	today: string;
	title: string;
	/** A day in the period before, and in the one after (null: it would be the future). */
	prevDay: string;
	nextDay: string | null;
	/** Today is in it: compared with the one before only as far in. */
	goingOn: boolean;
	/** One plug, or all (null). */
	plugId: string | null;
	plugs: { id: string; name: string; icon: string }[];
	buckets: StatsBucket[];
	total: { wh: number; euros: number | null };
	/** The period before, as far in as this one. */
	before: { wh: number; euros: number | null };
	/** All of them: each one's part, most first. */
	byPlug: { id: string; name: string; wh: number; euros: number | null }[];
	/** With a tariff by periods: punta, llano and valle. */
	byPeriod: { name: PeriodName; wh: number; euros: number }[] | null;
	price: KwhPrice | null;
}

const at = (day: string) => new Date(`${day}T12:00:00Z`);
const fmt = (opts: Intl.DateTimeFormatOptions) =>
	new Intl.DateTimeFormat('es-ES', { ...opts, timeZone: 'UTC' });
const weekday = fmt({ weekday: 'long', day: 'numeric' });
const shortWeekday = fmt({ weekday: 'narrow' });
const longDay = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dayMonth = fmt({ day: 'numeric', month: 'long' });
const monthYear = fmt({ month: 'long', year: 'numeric' });
const monthName = fmt({ month: 'long' });
const shortMonth = fmt({ month: 'short' });

/** The day `n` days after (or before) `day`. */
export function addDays(day: string, n: number) {
	return new Date(at(day).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

const firstOfMonth = (day: string) => `${day.slice(0, 7)}-01`;
function addMonths(day: string, n: number) {
	const [y, m] = day.split('-').map(Number) as [number, number];
	const d = new Date(Date.UTC(y, m - 1 + n, 1));
	return d.toISOString().slice(0, 10);
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The period of a view that holds `day`: its first day and the day after its last, the first of
 * the one before, its title, its columns, and which column an hour of a local day falls in.
 */
export function periodBounds(view: StatsView, day: string) {
	if (view === 'dia')
		return {
			start: day,
			end: addDays(day, 1),
			prevStart: addDays(day, -1),
			title: capital(longDay.format(at(day))),
			buckets: Array.from({ length: 24 }, (_, h) => ({
				key: `h${h}`,
				label: `${h}:00 a ${h + 1}:00`,
				tick: h % 6 === 0 ? `${h} h` : null
			})),
			keyOf: (_day: string, hour: number) => `h${hour}`
		};
	if (view === 'semana') {
		const back = (at(day).getUTCDay() + 6) % 7;
		const start = addDays(day, -back);
		const last = addDays(start, 6);
		const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
		return {
			start,
			end: addDays(start, 7),
			prevStart: addDays(start, -7),
			title:
				start.slice(0, 7) === last.slice(0, 7)
					? `Semana del ${Number(start.slice(8))} al ${dayMonth.format(at(last))}`
					: `Semana del ${dayMonth.format(at(start))} al ${dayMonth.format(at(last))}`,
			buckets: days.map((d) => ({
				key: d,
				label: weekday.format(at(d)),
				tick: `${shortWeekday.format(at(d)).toUpperCase()} ${Number(d.slice(8))}`
			})),
			keyOf: (d: string) => d
		};
	}
	if (view === 'mes') {
		const start = firstOfMonth(day);
		const end = addMonths(start, 1);
		const days: string[] = [];
		for (let d = start; d < end; d = addDays(d, 1)) days.push(d);
		return {
			start,
			end,
			prevStart: addMonths(start, -1),
			title: capital(monthYear.format(at(start))),
			buckets: days.map((d) => {
				const n = Number(d.slice(8));
				return {
					key: d,
					label: weekday.format(at(d)),
					tick: n === 1 || n % 7 === 1 ? String(n) : null
				};
			}),
			keyOf: (d: string) => d
		};
	}
	const year = day.slice(0, 4);
	const start = `${year}-01-01`;
	return {
		start,
		end: `${Number(year) + 1}-01-01`,
		prevStart: `${Number(year) - 1}-01-01`,
		title: year,
		buckets: Array.from({ length: 12 }, (_, i) => {
			const m = `${year}-${String(i + 1).padStart(2, '0')}`;
			return {
				key: m,
				label: capital(monthName.format(at(`${m}-01`))),
				tick: shortMonth.format(at(`${m}-01`)).replace('.', '')
			};
		}),
		keyOf: (d: string) => d.slice(0, 7)
	};
}
