import { and, desc, eq, gte, inArray, max, or, sql } from 'drizzle-orm';
import { familyMember, user, watchLog } from './db/schema.ts';
import type { Kitchen } from './fridge.ts';
import { localDay } from 'comun/agenda.ts';
import { WatchSteps } from 'comun/watch-steps.ts';

/**
 * What is watched and played at home, here (#421): the house sends the seconds of each slot (/api/casa/visto),
 * the whole of them and not what they grew by, so that sending twice changes nothing. Each adult
 * reads their own and the children's, never another adult's: at home, what one watches is theirs.
 */

export const KINDS = ['serie', 'pelicula', 'canal', 'web', 'juego', 'podcast'] as const;
export type WatchKind = (typeof KINDS)[number];
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

/** «Guardar lo que veo» as their house says it: off, what they listen to here is not counted. */
export async function setKeepsHistory(k: Kitchen, userId: string, on: boolean) {
	await k.run((tx) =>
		tx.update(familyMember).set({ keepHistory: on }).where(eq(familyMember.userId, userId))
	);
}

/** Whether what a person listens to here counts: a child's always; an adult's, as their house says. */
async function keepsHistory(k: Kitchen, userId: string) {
	const [member] = await k.run((tx) =>
		tx
			.select({ role: familyMember.role, keepHistory: familyMember.keepHistory })
			.from(familyMember)
			.where(eq(familyMember.userId, userId))
	);
	return !!member && (member.role === 'peque' || member.keepHistory);
}

/** The last position heard of each person, thing and player; in memory, a restart loses one step. */
const steps = new WatchSteps();
const SLOT_MINUTES = 10;

/** What is listened to, as a slot's row says it, but for its time. */
export type Listened = Pick<WatchRow, 'item' | 'kind' | 'seriesTitle' | 'title'>;

/**
 * Listened to here (#421), from where the player is now (`positionSec`), saved every few seconds:
 * what it moved forward since the last save of the same `source` (a browser, the house) is time
 * listened to, added to its slot. Not the house's rows, which come whole: these items are others.
 */
export async function addListened(
	k: Kitchen,
	userId: string,
	what: Listened,
	positionSec: number,
	source: string,
	now = new Date()
) {
	const step = steps.step(`${userId}:${what.item}:${source}`, positionSec, now.getTime());
	if (!step || !(await keepsHistory(k, userId))) return;
	const minute = now.getHours() * 60 + now.getMinutes();
	const row = {
		...what,
		familyId: k.familyId,
		userId,
		day: localDay(now),
		minute: minute - (minute % SLOT_MINUTES),
		season: null,
		number: null,
		seconds: step
	};
	await k.run((tx) =>
		tx
			.insert(watchLog)
			.values(row)
			.onConflictDoUpdate({
				target: [watchLog.userId, watchLog.day, watchLog.minute, watchLog.item],
				set: {
					seriesTitle: sql`excluded.series_title`,
					title: sql`excluded.title`,
					seconds: sql`${watchLog.seconds} + excluded.seconds`
				}
			})
	);
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
/** The days seen one by one, as /infantil at home: these two weeks, today the last. */
export const RECENT_DAYS = 14;
const RECENT_ITEMS = 15;

/** The `YYYY-MM-DD` of the last `count` days, today the last. */
export function lastDays(today: string, count: number) {
	const day = Date.parse(`${today}T00:00:00Z`);
	return Array.from({ length: count }, (_, i) =>
		new Date(day - (count - 1 - i) * 86_400_000).toISOString().slice(0, 10)
	);
}

/**
 * The hours of the last `weeks` weeks: per person, of those `viewerId` may see; and of `personId`,
 * if it is one of them, or of all of them, per week, per series and per hour of the day. Also, the
 * last `RECENT_DAYS` one by one and what was watched in them, the latest first. `kind`, of only
 * that kind (series, films, channels, webs or games); `kinds`, those there are in the period, to choose.
 */
export async function watchStats(
	k: Kitchen,
	viewerId: string,
	today: string,
	weeks: number,
	personId: string | null,
	kind: WatchKind | null = null
) {
	const mondays = lastMondays(today, weeks);
	const from = mondays[0];
	const days = lastDays(today, RECENT_DAYS);
	return k.run(async (tx) => {
		const visible = await tx
			.select({ id: familyMember.userId, name: user.name })
			.from(familyMember)
			.innerJoin(user, eq(user.id, familyMember.userId))
			.where(or(eq(familyMember.userId, viewerId), eq(familyMember.role, 'peque')));
		const ids = visible.map((p) => p.id);
		const chosen = personId && ids.includes(personId) ? personId : null;
		const seconds = sql<number>`coalesce(sum(${watchLog.seconds}), 0)::real`;
		const ofKind = kind ? eq(watchLog.kind, kind) : undefined;

		const inPeriod = ids.length
			? await tx
					.select({ id: watchLog.userId, kind: watchLog.kind, seconds })
					.from(watchLog)
					.where(and(inArray(watchLog.userId, ids), gte(watchLog.day, from)))
					.groupBy(watchLog.userId, watchLog.kind)
			: [];
		const of = new Map<string, number>();
		for (const p of inPeriod)
			if (!kind || p.kind === kind) of.set(p.id, (of.get(p.id) ?? 0) + p.seconds);
		const whoseIds = chosen ? [chosen] : ids;
		const kinds = KINDS.filter((x) =>
			inPeriod.some((p) => p.kind === x && whoseIds.includes(p.id) && p.seconds > 0)
		);
		const whose = and(inArray(watchLog.userId, whoseIds), gte(watchLog.day, from), ofKind);

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

		const recent = and(inArray(watchLog.userId, whoseIds), gte(watchLog.day, days[0]), ofKind);
		const day = sql<string>`to_char(${watchLog.day}, 'YYYY-MM-DD')`;
		const perDay = await tx.select({ day, seconds }).from(watchLog).where(recent).groupBy(day);
		const lastDay = sql<string>`to_char(${max(watchLog.day)}, 'YYYY-MM-DD')`;
		const latest = await tx
			.select({
				userId: watchLog.userId,
				item: watchLog.item,
				kind: watchLog.kind,
				seriesTitle: watchLog.seriesTitle,
				title: watchLog.title,
				season: watchLog.season,
				number: watchLog.number,
				seconds,
				lastDay
			})
			.from(watchLog)
			.where(recent)
			.groupBy(
				watchLog.userId,
				watchLog.item,
				watchLog.kind,
				watchLog.seriesTitle,
				watchLog.title,
				watchLog.season,
				watchLog.number
			)
			.orderBy(
				desc(sql`max(${watchLog.day}::timestamp + ${watchLog.minute} * interval '1 minute')`),
				sql`sum(${watchLog.seconds}) desc`
			)
			.limit(RECENT_ITEMS);

		const ofWeek = new Map(perWeek.map((w) => [w.week, w.seconds]));
		const ofHour = new Map(perHour.map((h) => [h.hour, h.seconds]));
		const ofDay = new Map(perDay.map((d) => [d.day, d.seconds]));
		return {
			person: chosen,
			kind,
			kinds,
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
			moreTitles: Math.max(0, perTitle.length - TOP_TITLES),
			days: days.map((d) => ({ day: d, seconds: ofDay.get(d) ?? 0 })),
			latest
		};
	});
}
