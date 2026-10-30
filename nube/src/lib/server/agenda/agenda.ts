import { randomBytes } from 'node:crypto';
import { and, asc, eq, exists, gte, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	agendaLink,
	calendarEvent,
	calendarEventPerson,
	familyMember,
	familyPerson,
	user
} from '#lib/server/db/schema.ts';
import type { AnyDb } from '#lib/server/family-scope.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { notify } from '#lib/server/push.ts';
import { tellGroup } from '#lib/server/telegram/bot.ts';
import { avatar, isAvatar } from 'comun/avatars.ts';
import {
	addDays,
	DAY_BEFORE_AT,
	dayName,
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
} from 'comun/agenda.ts';
import { nextStartDay, startDays } from './repeat.ts';

/**
 * The family's agenda (#253; jellycartoon's #200): every person of the family sees and changes all
 * of it. Its notices go to the phones (Web Push), and today's is on the fridge, here and on the
 * house's TV.
 */

const listeners = new Map<string, Set<() => void>>();

/** The family's open pages (the fridge's, the agenda's), told on every change and at midnight. */
export function watchAgenda(familyId: string, listener: () => void) {
	const set = listeners.get(familyId) ?? new Set();
	set.add(listener);
	listeners.set(familyId, set);
	return () => void set.delete(listener);
}

function changed(familyId: string | null) {
	for (const [family, set] of listeners)
		if (familyId === null || family === familyId) for (const listener of set) listener();
}

// ——— The family's people ———

/** Each person of the family with an account has their row, made the first time it is needed. */
async function withMembers(tx: AnyDb, familyId: string) {
	const missing = await tx
		.select({ id: user.id, name: user.name })
		.from(familyMember)
		.innerJoin(user, eq(user.id, familyMember.userId))
		.leftJoin(familyPerson, eq(familyPerson.userId, familyMember.userId))
		.where(isNull(familyPerson.id));
	if (missing.length)
		await tx
			.insert(familyPerson)
			.values(missing.map((m) => ({ familyId, userId: m.id, name: m.name })))
			.onConflictDoNothing();
}

/** Everyone of the family, those with an account first, with their drawing. */
export function agendaPeople(k: Kitchen): Promise<AgendaPerson[]> {
	return k.run(async (tx) => {
		await withMembers(tx, k.familyId);
		const rows = await tx
			.select({
				id: familyPerson.id,
				name: sql<string>`coalesce(${user.name}, ${familyPerson.name})`,
				userId: familyPerson.userId,
				avatar: familyPerson.avatar,
				role: familyMember.role
			})
			.from(familyPerson)
			.leftJoin(user, eq(user.id, familyPerson.userId))
			.leftJoin(familyMember, eq(familyMember.userId, familyPerson.userId))
			.orderBy(asc(familyPerson.createdAt), asc(familyPerson.id));
		return rows
			.map((r) => {
				const drawing = isAvatar(r.avatar) ? avatar(r.avatar) : null;
				return {
					id: String(r.id),
					name: r.name,
					// Without an account, or with a child's (#303).
					kid: !r.userId || r.role === 'peque',
					emoji: drawing?.emoji ?? null,
					color: drawing?.color ?? null
				};
			})
			.sort((a, b) => Number(a.kid) - Number(b.kid));
	});
}

/** For Ajustes: each one with their drawing's id, and whether they have an account. */
export function familyPeople(k: Kitchen) {
	return k.run(async (tx) => {
		await withMembers(tx, k.familyId);
		return tx
			.select({
				id: familyPerson.id,
				name: sql<string>`coalesce(${user.name}, ${familyPerson.name})`,
				avatar: familyPerson.avatar,
				account: sql<boolean>`${familyPerson.userId} is not null`,
				userId: familyPerson.userId
			})
			.from(familyPerson)
			.leftJoin(user, eq(user.id, familyPerson.userId))
			.orderBy(
				sql`${familyPerson.userId} is null`,
				asc(familyPerson.createdAt),
				asc(familyPerson.id)
			);
	});
}

/** The person row of someone with an account. */
export async function personOf(k: Kitchen, userId: string) {
	return k.run(async (tx) => {
		await withMembers(tx, k.familyId);
		const [row] = await tx
			.select({ id: familyPerson.id })
			.from(familyPerson)
			.where(eq(familyPerson.userId, userId));
		return row ? String(row.id) : null;
	});
}

/** One without an account (a child): its name and drawing. */
export async function addPerson(k: Kitchen, name: string, drawing: string | null) {
	await k.run((tx) =>
		tx
			.insert(familyPerson)
			.values({ familyId: k.familyId, name, avatar: isAvatar(drawing) ? drawing : null })
	);
	changed(k.familyId);
}

/** Its name (only one without an account: the others are their account's) and its drawing. */
export async function updatePerson(k: Kitchen, id: number, name: string, drawing: string | null) {
	await k.run(async (tx) => {
		const [row] = await tx
			.select({ userId: familyPerson.userId })
			.from(familyPerson)
			.where(eq(familyPerson.id, id));
		if (!row) return;
		await tx
			.update(familyPerson)
			.set({ ...(row.userId ? {} : { name }), avatar: isAvatar(drawing) ? drawing : null })
			.where(eq(familyPerson.id, id));
	});
	changed(k.familyId);
}

/** Only one without an account: the others are there while they are in the family. */
export async function deletePerson(k: Kitchen, id: number) {
	await k.run((tx) =>
		tx.delete(familyPerson).where(and(eq(familyPerson.id, id), isNull(familyPerson.userId)))
	);
	changed(k.familyId);
}

// ——— Events ———

type Row = typeof calendarEvent.$inferSelect;

const cols = {
	id: calendarEvent.id,
	familyId: calendarEvent.familyId,
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

async function peopleOf(tx: AnyDb, ids: number[]) {
	if (!ids.length) return new Map<number, string[]>();
	const rows = await tx
		.select()
		.from(calendarEventPerson)
		.where(inArray(calendarEventPerson.eventId, ids));
	const by = new Map<number, string[]>();
	for (const r of rows) by.set(r.eventId, [...(by.get(r.eventId) ?? []), String(r.personId)]);
	return by;
}

async function withPeople(
	tx: AnyDb,
	rows: (Row & { by?: string | null })[]
): Promise<AgendaEvent[]> {
	const people = await peopleOf(
		tx,
		rows.map((r) => r.id)
	);
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

/** For `personId`, only the ones for that person. */
const forPerson = (tx: AnyDb, personId: number | null) =>
	personId
		? exists(
				tx
					.select({ one: sql`1` })
					.from(calendarEventPerson)
					.where(
						and(
							eq(calendarEventPerson.eventId, calendarEvent.id),
							eq(calendarEventPerson.personId, personId)
						)
					)
			)
		: undefined;

/**
 * The events that take some day from `from` to `to`, and their repetitions there, each day by
 * day. With `personId`, only theirs (a child asking the house's voice).
 */
export function agendaBetween(
	k: Kitchen,
	from: string,
	to: string,
	personId: number | null = null
) {
	return k.run(async (tx) => {
		const rows = await tx
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
					forPerson(tx, personId)
				)
			)
			.orderBy(asc(calendarEvent.startDay), asc(calendarEvent.startTime));
		const events = await withPeople(tx, rows);
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
	});
}

/** Today's, for the fridge and the house's TV: everyone's, as there are no private ones. */
export async function agendaToday(k: Kitchen): Promise<AgendaToday> {
	const day = localDay();
	const [{ occurrences }, people] = await Promise.all([
		agendaBetween(k, day, day),
		agendaPeople(k)
	]);
	return { day, events: dayEvents(occurrences, day), people };
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

/** Only the family's people: an id that is not, left out. */
async function writePeople(tx: AnyDb, familyId: string, eventId: number, people: string[]) {
	await tx.delete(calendarEventPerson).where(eq(calendarEventPerson.eventId, eventId));
	const ids = people.map(Number).filter(Number.isInteger);
	const real = ids.length
		? await tx
				.select({ id: familyPerson.id })
				.from(familyPerson)
				.where(inArray(familyPerson.id, ids))
		: [];
	if (real.length)
		await tx
			.insert(calendarEventPerson)
			.values(real.map((p) => ({ familyId, eventId, personId: p.id })));
}

/** Written down by the kitchen's person (or the house's voice). Its id. */
export async function addEvent(k: Kitchen, input: EventInput) {
	const id = await k.run(async (tx) => {
		const [row] = await tx
			.insert(calendarEvent)
			.values({ ...values(input), familyId: k.familyId, userId: k.userId })
			.returning({ id: calendarEvent.id });
		await writePeople(tx, k.familyId, row!.id, input.people);
		return row!.id;
	});
	changed(k.familyId);
	void tellNew(k, input);
	return id;
}

/** To the family's group (its bot): «📅 María ha apuntado: Dentista, jueves 30 a las 17:00». */
async function tellNew(k: Kitchen, input: EventInput) {
	const people = await agendaPeople(k);
	const me = k.userId ? await personOf(k, k.userId) : null;
	const by = people.find((p) => p.id === me)?.name ?? 'Alguien';
	const when = `${dayName(input.startDay)}${input.startTime ? ` a las ${input.startTime}` : ''}`;
	const who = names(people, input.people);
	await tellGroup(
		k.familyId,
		'agenda',
		`📅 ${by} ha apuntado: ${input.title}, ${when}${who ? ` (${who})` : ''}`
	);
}

/**
 * Changed by anyone of the family: the repetitions skipped stay, and its notice is told again for
 * the next one (it may be another day, or another time). False if it is gone.
 */
export async function updateEvent(k: Kitchen, id: number, input: EventInput) {
	const done = await k.run(async (tx) => {
		const rows = await tx
			.update(calendarEvent)
			.set({ ...values(input), remindedDay: null })
			.where(eq(calendarEvent.id, id))
			.returning({ id: calendarEvent.id });
		if (!rows.length) return false;
		await writePeople(tx, k.familyId, id, input.people);
		return true;
	});
	if (done) changed(k.familyId);
	return done;
}

export async function deleteEvent(k: Kitchen, id: number) {
	const gone = await k.run((tx) =>
		tx.delete(calendarEvent).where(eq(calendarEvent.id, id)).returning({ id: calendarEvent.id })
	);
	changed(k.familyId);
	return gone.length > 0;
}

/** «Esta vez no»: the repetition that starts on `day`, skipped. A single one, deleted. */
export async function skipDay(k: Kitchen, id: number, day: string) {
	const [row] = await k.run((tx) =>
		tx.select(cols).from(calendarEvent).where(eq(calendarEvent.id, id))
	);
	if (!row) return false;
	if (!row.repeat) return deleteEvent(k, id);
	if (!row.skipDays.includes(day))
		await k.run((tx) =>
			tx
				.update(calendarEvent)
				.set({ skipDays: [...row.skipDays, day].sort() })
				.where(eq(calendarEvent.id, id))
		);
	changed(k.familyId);
	return true;
}

// ——— Midnight: the fridge's «Hoy» is another day, for every family. ———

/** At midnight, every family's open pages; from the scheduler (scheduler.ts). */
export const newDay = () => changed(null);

// ——— Notices ———

/** «Lucía y Pablo». */
export function names(people: AgendaPerson[], ids: string[]) {
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

/** The accounts of these people of the family (to their phones). */
async function accountsOf(k: Kitchen, personIds: string[]) {
	const ids = personIds.map(Number).filter(Number.isInteger);
	if (!ids.length) return [];
	const rows = await k.run((tx) =>
		tx
			.select({ userId: familyPerson.userId })
			.from(familyPerson)
			.where(and(inArray(familyPerson.id, ids), isNotNull(familyPerson.userId)))
	);
	return rows.map((r) => r.userId!);
}

/** Everyone of the family with an account. */
export async function familyAccounts(k: Kitchen) {
	const rows = await k.run((tx) => tx.select({ id: familyMember.userId }).from(familyMember));
	return rows.map((r) => r.id);
}

/** The people's accounts; if none has one (children, or nobody), everyone's of the family. */
export async function toldOf(k: Kitchen, personIds: string[]) {
	const told = await accountsOf(k, personIds);
	return told.length ? told : familyAccounts(k);
}

/**
 * Every minute, for a family (scheduler.ts): the notices due, each repetition's once. To the people
 * it is for with an account; if none has one, to all of them. One due while the server was off is
 * told if it has not started yet.
 */
export async function sendDue(k: Kitchen) {
	const now = new Date();
	const today = localDay(now);
	const at = `${today}T${localTime(now)}`;
	const rows = await k.run((tx) =>
		tx.select(cols).from(calendarEvent).where(isNotNull(calendarEvent.remind))
	);
	if (!rows.length) return;
	let people: AgendaPerson[] | null = null;
	const ids = await k.run((tx) =>
		peopleOf(
			tx,
			rows.map((r) => r.id)
		)
	);
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
			const claimed = await k.run((tx) =>
				tx
					.update(calendarEvent)
					.set({ remindedDay: day })
					.where(
						and(
							eq(calendarEvent.id, r.id),
							or(isNull(calendarEvent.remindedDay), lt(calendarEvent.remindedDay, day))
						)
					)
					.returning({ id: calendarEvent.id })
			);
			if (!claimed.length) continue;
			people ??= await agendaPeople(k);
			const forThem = ids.get(r.id) ?? [];
			const who = names(people, forThem);
			const when = e.startTime ?? 'todo el día';
			await notify(k.familyId, await toldOf(k, forThem), {
				title: `📅 ${e.remind === 'dia' ? 'Mañana' : 'En una hora'}: ${e.title}`,
				body: who ? `${when} · ${who}` : when,
				tag: `agenda-${r.id}`,
				url: `/agenda?dia=${day}`,
				ttl: 6 * 3600
			});
			await tellGroup(
				k.familyId,
				'agenda',
				`📅 ${e.remind === 'dia' ? 'Mañana' : 'En una hora'}: ${e.title} (${when}${who ? ` · ${who}` : ''})`
			);
			console.info(`[agenda] Aviso de «${e.title}» del ${day}`, { eventId: r.id });
		}
	}
}

// ——— For the house's voice ———

/** A day's, as said: «17:00 Dentista (Lucía)». */
export async function dayForVoice(k: Kitchen, day: string, personId: number | null = null) {
	const [{ occurrences }, people] = await Promise.all([
		agendaBetween(k, day, day, personId),
		agendaPeople(k)
	]);
	return dayEvents(occurrences, day).map((o) => {
		const who = names(people, o.people);
		const time = o.day === day && o.startTime ? `${o.startTime} ` : '';
		return `${time}${o.title}${who ? ` (${who})` : ''}`;
	});
}

const fold = (s: string) =>
	s
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.trim();

/** Someone of the family by their name, as said: «Lucía», «lucia». */
export async function personByName(k: Kitchen, name: string) {
	const wanted = fold(name);
	const people = await agendaPeople(k);
	return (
		people.find((p) => fold(p.name) === wanted) ??
		people.find((p) => fold(p.name).split(/\s+/)[0] === wanted) ??
		null
	);
}

export { dayName };

// ——— The .ics link ———

/** The family's link's secret: made the first time it is asked for, or again to change it. */
export async function icsToken(k: Kitchen, renew = false) {
	return k.run(async (tx) => {
		const [saved] = renew ? [] : await tx.select().from(agendaLink);
		if (saved) return saved.token;
		const token = randomBytes(24).toString('base64url');
		await tx
			.insert(agendaLink)
			.values({ familyId: k.familyId, token })
			.onConflictDoUpdate({ target: agendaLink.familyId, set: { token } });
		return token;
	});
}

/**
 * The family of a link's secret, or null: Postgres is told the secret (`app.ics_token`), which is
 * all its policy lets it see.
 */
export async function familyOfIcs(token: string) {
	return db.transaction(async (tx) => {
		await tx.execute(sql`select set_config('app.ics_token', ${token}, true)`);
		const [found] = await tx
			.select({ familyId: agendaLink.familyId })
			.from(agendaLink)
			.where(eq(agendaLink.token, token));
		return found?.familyId ?? null;
	});
}

/** Every event, for the .ics, with the names of who each is for. */
export async function allEvents(k: Kitchen) {
	const [{ rows, events }, people] = await Promise.all([
		k.run(async (tx) => {
			const rows = await tx.select(cols).from(calendarEvent).orderBy(asc(calendarEvent.startDay));
			return { rows, events: await withPeople(tx, rows) };
		}),
		agendaPeople(k)
	]);
	return events.map((e, i) => ({
		...e,
		repeatRule: rows[i]!.repeat,
		createdAt: rows[i]!.createdAt,
		names: names(people, e.people)
	}));
}
