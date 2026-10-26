import { randomBytes, timingSafeEqual } from 'node:crypto';
import { and, asc, eq, exists, gte, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	calendarEvent,
	calendarEventPerson,
	kidProfile,
	user,
	userSettings
} from '#lib/server/db/schema.ts';
import { getAppSetting, setAppSetting } from '#lib/server/app-settings.ts';
import { isKid } from '#lib/server/kids.ts';
import { log } from '#lib/server/log.ts';
import { notify } from '#lib/server/push.ts';
import { avatar, isAvatar } from '#lib/avatars.ts';
import {
	addDays,
	DAY_BEFORE_AT,
	daysBetween,
	dayEvents,
	fromRrule,
	localDay,
	localTime,
	toRrule,
	type AgendaEvent,
	type AgendaPerson,
	type AgendaToday,
	type EventInput,
	type Occurrence
} from '#lib/agenda.ts';
import { nextStartDay, startDays } from './repeat.ts';

/**
 * The house's agenda (#200): a family's. Every adult sees and changes all of it; a child, only
 * what is for them. Its notices go to the phones (Web Push), and today's is on the fridge.
 */

const listeners = new Set<() => void>();

/** The open pages (the fridge's, the TV's), told on every change and when the day changes. */
export function watchAgenda(listener: () => void) {
	listeners.add(listener);
	return () => void listeners.delete(listener);
}

function changed() {
	for (const listener of listeners) listener();
}

/** Everyone of the house, adults first, with their drawing. */
export async function agendaPeople(): Promise<AgendaPerson[]> {
	const rows = await db
		.select({
			id: user.id,
			name: user.name,
			role: user.role,
			kidAvatar: kidProfile.avatar,
			adultAvatar: userSettings.avatar
		})
		.from(user)
		.leftJoin(kidProfile, eq(kidProfile.userId, user.id))
		.leftJoin(userSettings, eq(userSettings.userId, user.id))
		.orderBy(asc(user.createdAt));
	return rows
		.map((r) => {
			const kid = isKid(r);
			const drawing = kid
				? avatar(r.kidAvatar)
				: isAvatar(r.adultAvatar)
					? avatar(r.adultAvatar)
					: null;
			return {
				id: r.id,
				name: r.name,
				kid,
				emoji: drawing?.emoji ?? null,
				color: drawing?.color ?? null
			};
		})
		.sort((a, b) => Number(a.kid) - Number(b.kid));
}

type Row = typeof calendarEvent.$inferSelect;

const cols = {
	id: calendarEvent.id,
	title: calendarEvent.title,
	notes: calendarEvent.notes,
	startDay: calendarEvent.startDay,
	startTime: calendarEvent.startTime,
	endDay: calendarEvent.endDay,
	endTime: calendarEvent.endTime,
	repeat: calendarEvent.repeat,
	skipDays: calendarEvent.skipDays,
	remind: calendarEvent.remind,
	remindedDay: calendarEvent.remindedDay,
	userId: calendarEvent.userId,
	createdAt: calendarEvent.createdAt
};

const hhmm = (time: string | null) => time?.slice(0, 5) ?? null;

async function peopleOf(ids: number[]) {
	if (!ids.length) return new Map<number, string[]>();
	const rows = await db
		.select()
		.from(calendarEventPerson)
		.where(inArray(calendarEventPerson.eventId, ids));
	const by = new Map<number, string[]>();
	for (const r of rows) by.set(r.eventId, [...(by.get(r.eventId) ?? []), r.userId]);
	return by;
}

async function withPeople(rows: (Row & { by?: string | null })[]): Promise<AgendaEvent[]> {
	const people = await peopleOf(rows.map((r) => r.id));
	return rows.map((r) => ({
		id: r.id,
		title: r.title,
		notes: r.notes,
		startDay: r.startDay,
		startTime: hhmm(r.startTime),
		endDay: r.endDay,
		endTime: hhmm(r.endTime),
		repeat: fromRrule(r.repeat),
		remind: r.remind,
		people: people.get(r.id) ?? [],
		skipDays: r.skipDays,
		by: r.by ?? null
	}));
}

/** For `kidId`, only the ones for that child. */
const forKid = (kidId: string | null) =>
	kidId
		? exists(
				db
					.select({ one: sql`1` })
					.from(calendarEventPerson)
					.where(
						and(
							eq(calendarEventPerson.eventId, calendarEvent.id),
							eq(calendarEventPerson.userId, kidId)
						)
					)
			)
		: undefined;

/**
 * The events that take some day from `from` to `to`, and their repetitions there, each day by
 * day. A child (`kidId`) sees only theirs.
 */
export async function agendaBetween(from: string, to: string, kidId: string | null = null) {
	const rows = await db
		.select({ ...cols, by: user.name })
		.from(calendarEvent)
		.leftJoin(user, eq(user.id, calendarEvent.userId))
		.where(
			and(
				lt(calendarEvent.startDay, addDays(to, 1)),
				or(
					isNotNull(calendarEvent.repeat),
					gte(sql`coalesce(${calendarEvent.endDay}, ${calendarEvent.startDay})`, from)
				),
				forKid(kidId)
			)
		)
		.orderBy(asc(calendarEvent.startDay), asc(calendarEvent.startTime));
	const events = await withPeople(rows);
	const occurrences: Occurrence[] = [];
	for (const [i, e] of events.entries()) {
		const span = e.endDay ? Math.max(0, daysBetween(e.startDay, e.endDay)) : 0;
		for (const day of startDays(rows[i]!, from, to))
			occurrences.push({
				eventId: e.id,
				title: e.title,
				day,
				lastDay: addDays(day, span),
				startTime: e.startTime,
				endTime: e.endTime,
				people: e.people,
				repeats: e.repeat.every !== null
			});
	}
	return { events, occurrences };
}

/** Today's, for the fridge and the TV: everyone's, as there are no private ones. */
export async function agendaToday(): Promise<AgendaToday> {
	const day = localDay();
	const [{ occurrences }, people] = await Promise.all([agendaBetween(day, day), agendaPeople()]);
	return { day, events: dayEvents(occurrences, day), people };
}

/** Only those of the house: an id that is not, left out. */
async function realPeople(ids: string[]) {
	if (!ids.length) return [];
	const rows = await db.select({ id: user.id }).from(user).where(inArray(user.id, ids));
	return rows.map((r) => r.id);
}

function values(input: EventInput) {
	return {
		title: input.title,
		notes: input.notes,
		startDay: input.startDay,
		startTime: input.startTime,
		endDay: input.endDay,
		endTime: input.endTime,
		repeat: toRrule(input.repeat),
		remind: input.remind
	};
}

async function writePeople(eventId: number, people: string[]) {
	await db.delete(calendarEventPerson).where(eq(calendarEventPerson.eventId, eventId));
	const real = await realPeople(people);
	if (real.length)
		await db.insert(calendarEventPerson).values(real.map((userId) => ({ eventId, userId })));
}

/** Written down by `userId`. Its id. */
export async function addEvent(userId: string | null, input: EventInput) {
	const [row] = await db
		.insert(calendarEvent)
		.values({ ...values(input), userId })
		.returning({ id: calendarEvent.id });
	await writePeople(row!.id, input.people);
	changed();
	return row!.id;
}

/**
 * Changed by any adult: the repetitions skipped stay, and its notice is told again for the next
 * one (it may be another day, or another time). False if it is gone.
 */
export async function updateEvent(id: number, input: EventInput) {
	const done = await db
		.update(calendarEvent)
		.set({ ...values(input), remindedDay: null })
		.where(eq(calendarEvent.id, id))
		.returning({ id: calendarEvent.id });
	if (!done.length) return false;
	await writePeople(id, input.people);
	changed();
	return true;
}

export async function deleteEvent(id: number) {
	const gone = await db
		.delete(calendarEvent)
		.where(eq(calendarEvent.id, id))
		.returning({ id: calendarEvent.id });
	changed();
	return gone.length > 0;
}

/** «Esta vez no»: the repetition that starts on `day`, skipped. A single one, deleted. */
export async function skipDay(id: number, day: string) {
	const [row] = await db.select(cols).from(calendarEvent).where(eq(calendarEvent.id, id));
	if (!row) return false;
	if (!row.repeat) return deleteEvent(id);
	if (!row.skipDays.includes(day))
		await db
			.update(calendarEvent)
			.set({ skipDays: [...row.skipDays, day].sort() })
			.where(eq(calendarEvent.id, id));
	changed();
	return true;
}

/** Whether `kidId`'s: a child opens only theirs. */
export async function isFor(eventId: number, kidId: string) {
	const [row] = await db
		.select({ one: sql`1` })
		.from(calendarEventPerson)
		.where(and(eq(calendarEventPerson.eventId, eventId), eq(calendarEventPerson.userId, kidId)));
	return Boolean(row);
}

// ——— Midnight: the fridge's «Hoy» is another day. ———

function atMidnight() {
	const now = new Date();
	const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
	setTimeout(() => {
		changed();
		atMidnight();
	}, next.getTime() - now.getTime()).unref();
}

// ——— Notices ———

/** «Lucía y Pablo». */
function names(people: AgendaPerson[], ids: string[]) {
	const these = people.filter((p) => ids.includes(p.id)).map((p) => p.name);
	const last = these.pop();
	return these.length ? `${these.join(', ')} y ${last}` : (last ?? '');
}

/** When its notice is due for the repetition on `day`, as `YYYY-MM-DDTHH:MM`; null, none. */
function dueAt(e: { remind: 'hora' | 'dia' | null; startTime: string | null }, day: string) {
	if (e.remind === 'dia') return `${addDays(day, -1)}T${DAY_BEFORE_AT}`;
	if (e.remind !== 'hora' || !e.startTime) return null;
	const [h, m] = e.startTime.split(':').map(Number);
	const before = new Date(Date.UTC(2000, 0, 1, h!, m! - 60));
	const onDay = before.getUTCDate() === 1 ? day : addDays(day, -1);
	return `${onDay}T${before.toISOString().slice(11, 16)}`;
}

/** When it starts, the same way: an all-day one, at the start of its day. */
const startsAt = (e: { startTime: string | null }, day: string) =>
	`${day}T${e.startTime ?? '00:00'}`;

/**
 * Every minute: the notices due, each repetition's once. To the adults it is for; if it is only
 * for children, or for nobody, to all of them. One due while the server was off is told if it has
 * not started yet.
 */
async function sendDue() {
	const now = new Date();
	const today = localDay(now);
	const at = `${today}T${localTime(now)}`;
	const rows = await db.select(cols).from(calendarEvent).where(isNotNull(calendarEvent.remind));
	if (!rows.length) return;
	let people: AgendaPerson[] | null = null;
	const ids = await peopleOf(rows.map((r) => r.id));
	for (const r of rows) {
		const e = { ...r, startTime: hhmm(r.startTime) };
		const days = new Set(
			[nextStartDay(e, today), nextStartDay(e, addDays(today, 1))].filter((d) => d !== null)
		);
		for (const day of days) {
			const due = dueAt(e, day);
			if (!due || at < due || at >= startsAt(e, day)) continue;
			if (r.remindedDay && r.remindedDay >= day) continue;
			// Claimed first: told once, though two servers looked at the same minute.
			const claimed = await db
				.update(calendarEvent)
				.set({ remindedDay: day })
				.where(
					and(
						eq(calendarEvent.id, r.id),
						or(isNull(calendarEvent.remindedDay), lt(calendarEvent.remindedDay, day))
					)
				)
				.returning({ id: calendarEvent.id });
			if (!claimed.length) continue;
			people ??= await agendaPeople();
			const forThem = ids.get(r.id) ?? [];
			const adults = people.filter((p) => !p.kid);
			const told = adults.filter((p) => forThem.includes(p.id)).map((p) => p.id);
			const who = names(people, forThem);
			const when = e.startTime ?? 'todo el día';
			await notify(told.length ? told : adults.map((p) => p.id), {
				title: `📅 ${e.remind === 'dia' ? 'Mañana' : 'En una hora'}: ${e.title}`,
				body: who ? `${when} · ${who}` : when,
				tag: `agenda-${r.id}`,
				url: `/agenda?dia=${day}`,
				ttl: 6 * 3600
			});
			log.info('agenda', `Aviso de «${e.title}» del ${day}`, { eventId: r.id, day });
		}
	}
}

/** The notices, every minute, and the fridge's day changed at midnight. */
export function startAgenda() {
	atMidnight();
	setInterval(() => {
		sendDue().catch((error) => log.error('agenda', 'No se pudieron mirar los avisos', { error }));
	}, 60_000).unref();
}

// ——— For the voice ———

/** A day's, as said: «17:00 Dentista (Lucía)». */
export async function dayForVoice(day: string, kidId: string | null = null) {
	const [{ occurrences }, people] = await Promise.all([
		agendaBetween(day, day, kidId),
		agendaPeople()
	]);
	return dayEvents(occurrences, day).map((o) => {
		const who = names(people, o.people);
		const time = o.day === day && o.startTime ? `${o.startTime} ` : '';
		return `${time}${o.title}${who ? ` (${who})` : ''}`;
	});
}

/** Someone of the house by their name, as said: «Lucía», «lucia». */
export async function personByName(name: string) {
	const fold = (s: string) =>
		s
			.normalize('NFD')
			.replace(/\p{Diacritic}/gu, '')
			.toLowerCase()
			.trim();
	const wanted = fold(name);
	const people = await agendaPeople();
	return (
		people.find((p) => fold(p.name) === wanted) ??
		people.find((p) => fold(p.name).split(/\s+/)[0] === wanted) ??
		null
	);
}

// ——— The .ics link ———

/** The house's link's secret: made the first time it is asked for. */
export async function icsToken(renew = false) {
	const saved = renew ? null : await getAppSetting('agenda_ics_token');
	if (saved) return saved;
	const made = randomBytes(24).toString('base64url');
	await setAppSetting('agenda_ics_token', made);
	return made;
}

export async function isIcsToken(token: string) {
	const saved = await getAppSetting('agenda_ics_token');
	if (!saved) return false;
	const a = Buffer.from(saved);
	const b = Buffer.from(token);
	return a.length === b.length && timingSafeEqual(a, b);
}

/** Every event, for the .ics, with the names of who each is for. */
export async function allEvents() {
	const rows = await db.select(cols).from(calendarEvent).orderBy(asc(calendarEvent.startDay));
	const [events, people] = await Promise.all([withPeople(rows), agendaPeople()]);
	return events.map((e, i) => ({
		...e,
		repeatRule: rows[i]!.repeat,
		createdAt: rows[i]!.createdAt,
		names: names(people, e.people)
	}));
}
