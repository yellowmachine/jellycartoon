import { and, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { familyMember, user, watchLog } from './db/schema.ts';
import type { Kitchen } from './fridge.ts';

/**
 * What is watched at home, here (#421): the house sends the seconds of each slot (/api/casa/visto),
 * the whole of them and not what they grew by, so that sending twice changes nothing. Each adult
 * reads their own and the children's, never another adult's: at home, what one watches is theirs.
 */

const KINDS = ['serie', 'pelicula', 'canal', 'web'] as const;
export const MAX_ROWS = 500;
const MAX_TEXT = 500;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SECONDS_IN_A_DAY = 86_400;

export interface WatchRow {
	day: string;
	minute: number;
	item: string;
	kind: (typeof KINDS)[number];
	seriesTitle: string | null;
	title: string;
	season: number | null;
	number: number | null;
	seconds: number;
}

const whole = (value: unknown) => (Number.isInteger(value) ? (value as number) : null);

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);

function parseRow(row: Record<string, unknown>): WatchRow | null {
	const { day, minute, item, kind, seriesTitle, title, season, number, seconds } = row;
	if (typeof day !== 'string' || !DAY.test(day) || Number.isNaN(Date.parse(day))) return null;
	if (!Number.isInteger(minute) || (minute as number) < 0 || (minute as number) > 1439) return null;
	if (typeof item !== 'string' || !item || item.length > 100) return null;
	if (!KINDS.includes(kind as WatchRow['kind'])) return null;
	const name = text(title);
	if (!name) return null;
	if (typeof seconds !== 'number' || !(seconds >= 0) || seconds > SECONDS_IN_A_DAY) return null;
	return {
		day,
		minute: minute as number,
		item,
		kind: kind as WatchRow['kind'],
		seriesTitle: text(seriesTitle)?.slice(0, MAX_TEXT) ?? null,
		title: name.slice(0, MAX_TEXT),
		season: whole(season),
		number: whole(number),
		seconds
	};
}

/** What the house sent, checked; null if any of it is wrong, for it not to be half kept. */
export function parseWatchRows(rows: unknown): WatchRow[] | null {
	if (!Array.isArray(rows) || rows.length > MAX_ROWS) return null;
	const parsed = rows.map((row) => (row && typeof row === 'object' ? parseRow(row) : null));
	return parsed.every((row) => row !== null) ? (parsed as WatchRow[]) : null;
}

/** Each slot as sent: what was there is replaced. */
export async function saveWatched(k: Kitchen, userId: string, rows: WatchRow[]) {
	// The same slot twice in a request is one, the last: Postgres refuses to update a row twice.
	const slots = new Map(rows.map((r) => [`${r.day} ${r.minute} ${r.item}`, r]));
	if (!slots.size) return;
	await k.run((tx) =>
		tx
			.insert(watchLog)
			.values([...slots.values()].map((r) => ({ ...r, familyId: k.familyId, userId })))
			.onConflictDoUpdate({
				target: [watchLog.userId, watchLog.day, watchLog.minute, watchLog.item],
				set: {
					kind: sql`excluded.kind`,
					seriesTitle: sql`excluded.series_title`,
					title: sql`excluded.title`,
					season: sql`excluded.season`,
					number: sql`excluded.number`,
					seconds: sql`excluded.seconds`
				}
			})
	);
}

/** All that was sent of this person: «Guardar lo que veo» turned off at home. */
export async function forgetWatched(k: Kitchen, userId: string) {
	await k.run((tx) => tx.delete(watchLog).where(eq(watchLog.userId, userId)));
}

/** The Monday of a `YYYY-MM-DD`'s week. */
export function mondayOf(day: string) {
	const date = new Date(`${day}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
	return date.toISOString().slice(0, 10);
}

/** The Mondays of the last `count` weeks, this one the last. */
export function lastMondays(today: string, count: number) {
	const monday = Date.parse(`${mondayOf(today)}T00:00:00Z`);
	return Array.from({ length: count }, (_, i) =>
		new Date(monday - (count - 1 - i) * 7 * 86_400_000).toISOString().slice(0, 10)
	);
}

const TOP_TITLES = 15;

/**
 * The hours of the last `weeks` weeks: per person, of those `viewerId` may see; and of `personId`,
 * if it is one of them, or of all of them, per week, per series and per hour of the day.
 */
export async function watchStats(
	k: Kitchen,
	viewerId: string,
	today: string,
	weeks: number,
	personId: string | null
) {
	const mondays = lastMondays(today, weeks);
	const from = mondays[0];
	return k.run(async (tx) => {
		const visible = await tx
			.select({ id: familyMember.userId, name: user.name })
			.from(familyMember)
			.innerJoin(user, eq(user.id, familyMember.userId))
			.where(or(eq(familyMember.userId, viewerId), eq(familyMember.role, 'peque')));
		const ids = visible.map((p) => p.id);
		const chosen = personId && ids.includes(personId) ? personId : null;
		const seconds = sql<number>`coalesce(sum(${watchLog.seconds}), 0)::real`;

		const perPerson = ids.length
			? await tx
					.select({ id: watchLog.userId, seconds })
					.from(watchLog)
					.where(and(inArray(watchLog.userId, ids), gte(watchLog.day, from)))
					.groupBy(watchLog.userId)
			: [];
		const whose = and(inArray(watchLog.userId, chosen ? [chosen] : ids), gte(watchLog.day, from));

		const week = sql<string>`to_char(date_trunc('week', ${watchLog.day}::timestamp), 'YYYY-MM-DD')`;
		const perWeek = await tx.select({ week, seconds }).from(watchLog).where(whose).groupBy(week);
		const hour = sql<number>`(${watchLog.minute} / 60)::int`;
		const perHour = await tx.select({ hour, seconds }).from(watchLog).where(whose).groupBy(hour);
		const label = sql<string>`coalesce(${watchLog.seriesTitle}, ${watchLog.title})`;
		const perTitle = await tx
			.select({ label, kind: watchLog.kind, seconds })
			.from(watchLog)
			.where(whose)
			.groupBy(label, watchLog.kind)
			.orderBy(sql`sum(${watchLog.seconds}) desc`);

		const of = new Map(perPerson.map((p) => [p.id, p.seconds]));
		const ofWeek = new Map(perWeek.map((w) => [w.week, w.seconds]));
		const ofHour = new Map(perHour.map((h) => [h.hour, h.seconds]));
		return {
			person: chosen,
			people: visible
				.map((p) => ({
					id: p.id,
					name: p.name,
					me: p.id === viewerId,
					seconds: of.get(p.id) ?? 0
				}))
				.sort((a, b) => b.seconds - a.seconds),
			weeks: mondays.map((monday) => ({ monday, seconds: ofWeek.get(monday) ?? 0 })),
			hours: Array.from({ length: 24 }, (_, h) => ({ hour: h, seconds: ofHour.get(h) ?? 0 })),
			titles: perTitle.slice(0, TOP_TITLES),
			moreTitles: Math.max(0, perTitle.length - TOP_TITLES)
		};
	});
}
