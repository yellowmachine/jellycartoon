import { and, asc, gte, lt } from 'drizzle-orm';
import { plug, plugEnergy } from '../db/schema.ts';
import { withFamily } from '../family.ts';
import type { AnyDb } from '../family-scope.ts';
import { periodAt, priceAt, type KwhPrice, type PeriodName } from '#lib/kwh-price.ts';
import { PLUG_KINDS, type PlugKind } from '#lib/plugs.ts';
import {
	periodBounds,
	STATS_VIEWS,
	TIME_ZONE,
	type StatsView,
	type PlugStats
} from '#lib/plug-stats.ts';
import { priceOf } from './plugs.ts';

/**
 * Enchufes → Consumo (#396): what the plugs used by day, week, month and year, from what each
 * keeps by the hour (plug_energy, never deleted). Euros at today's price (kwh-price.ts), each hour
 * at its own with a tariff by periods. Compared with the period before up to the same point, so a
 * week going on is not set against a whole one.
 */

const parts = new Intl.DateTimeFormat('en-CA', {
	timeZone: TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	hourCycle: 'h23'
});

/** An instant's local day and hour: «2026-11-08», 6. */
function localOf(at: Date) {
	const p = Object.fromEntries(parts.formatToParts(at).map((x) => [x.type, x.value]));
	return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

/** The instant a local day starts (its midnight, in the family's time zone). */
export function dayStart(day: string) {
	const [y, m, d] = day.split('-').map(Number) as [number, number, number];
	let at = Date.UTC(y, m - 1, d);
	// Twice: the offset of the guess, then of the right instant (a change of hour that night).
	for (let i = 0; i < 2; i++) {
		const local = localOf(new Date(at));
		const [ly, lm, ld] = local.day.split('-').map(Number) as [number, number, number];
		const shown = Date.UTC(ly, lm - 1, ld, local.hour);
		at -= shown - Date.UTC(y, m - 1, d);
	}
	return new Date(at);
}

const isView = (v: unknown): v is StatsView => STATS_VIEWS.includes(v as StatsView);
const isDay = (v: unknown): v is string =>
	typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

interface Row {
	plugId: string;
	hour: Date;
	wh: number;
}

/** The family's use in a view around a day, of one plug or all; null if that plug is not its. */
export async function plugStats(
	userId: string,
	ask: { view?: unknown; day?: unknown; plugId?: unknown },
	now = new Date()
): Promise<PlugStats | null> {
	return withFamily(userId, (tx) => statsIn(tx, ask, now));
}

export async function statsIn(
	tx: AnyDb,
	ask: { view?: unknown; day?: unknown; plugId?: unknown },
	now: Date
): Promise<PlugStats | null> {
	const today = localOf(now).day;
	const view = isView(ask.view) ? ask.view : 'semana';
	const day = isDay(ask.day) && ask.day <= today ? ask.day : today;
	const plugs = await tx
		.select({ id: plug.id, name: plug.name, kind: plug.kind })
		.from(plug)
		.orderBy(asc(plug.createdAt));
	const plugId = typeof ask.plugId === 'string' && ask.plugId ? ask.plugId : null;
	if (plugId && !plugs.some((p) => p.id === plugId)) return null;

	const b = periodBounds(view, day);
	const start = dayStart(b.start);
	const end = dayStart(b.end);
	const prevStart = dayStart(b.prevStart);
	// Going on: the one before only as far in.
	const upTo = Math.min(end.getTime(), now.getTime());
	const prevEnd = new Date(
		Math.min(prevStart.getTime() + (upTo - start.getTime()), start.getTime())
	);

	const [rows, price] = await Promise.all([
		tx
			.select({ plugId: plugEnergy.plugId, hour: plugEnergy.hour, wh: plugEnergy.wh })
			.from(plugEnergy)
			.where(and(gte(plugEnergy.hour, prevStart), lt(plugEnergy.hour, end))),
		priceOf(tx)
	]);
	const mine = (rows as Row[]).filter((r) => !plugId || r.plugId === plugId);
	const euros = (r: Row) => (price ? (r.wh / 1000) * priceAt(price, r.hour) : 0);

	const buckets = b.buckets.map((bucket) => ({
		...bucket,
		wh: 0,
		euros: 0,
		parts: {} as Record<string, number>
	}));
	const index = new Map(buckets.map((x, i) => [x.key, i]));
	const byPlug = new Map<string, { wh: number; euros: number }>();
	const byPeriod: Record<PeriodName, { wh: number; euros: number }> = {
		P1: { wh: 0, euros: 0 },
		P2: { wh: 0, euros: 0 },
		P3: { wh: 0, euros: 0 }
	};
	const total = { wh: 0, euros: 0 };
	const before = { wh: 0, euros: 0 };
	for (const r of mine) {
		const eur = euros(r);
		if (r.hour < start) {
			if (r.hour < prevEnd) {
				before.wh += r.wh;
				before.euros += eur;
			}
			continue;
		}
		const local = localOf(r.hour);
		const key = b.keyOf(local.day, local.hour);
		const i = index.get(key);
		if (i === undefined) continue;
		const bucket = buckets[i]!;
		bucket.wh += r.wh;
		bucket.euros += eur;
		bucket.parts[r.plugId] = (bucket.parts[r.plugId] ?? 0) + r.wh;
		total.wh += r.wh;
		total.euros += eur;
		const one = byPlug.get(r.plugId) ?? { wh: 0, euros: 0 };
		one.wh += r.wh;
		one.euros += eur;
		byPlug.set(r.plugId, one);
		const period = byPeriod[periodAt(r.hour)];
		period.wh += r.wh;
		period.euros += eur;
	}

	const withPrice = <T extends { euros: number }>(x: T) => ({
		...x,
		euros: price ? x.euros : null
	});
	return {
		view,
		day,
		today,
		title: b.title,
		prevDay: b.prevStart,
		nextDay: b.end <= today ? b.end : null,
		goingOn: now.getTime() < end.getTime(),
		plugId,
		plugs: plugs.map((p) => ({
			id: p.id,
			name: p.name,
			icon: PLUG_KINDS[p.kind as PlugKind]?.icon ?? '🔌'
		})),
		buckets: buckets.map(withPrice),
		total: withPrice(total),
		before: withPrice(before),
		byPlug: plugId
			? []
			: plugs
					.map((p) => ({
						id: p.id,
						name: p.name,
						...withPrice(byPlug.get(p.id) ?? { wh: 0, euros: 0 })
					}))
					.filter((p) => p.wh > 0)
					.sort((x, y) => y.wh - x.wh),
		byPeriod: price?.periods
			? (Object.entries(byPeriod) as [PeriodName, { wh: number; euros: number }][]).map(
					([name, v]) => ({ name, ...v })
				)
			: null,
		price: price as KwhPrice | null
	};
}
