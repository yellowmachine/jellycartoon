import { and, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { addDays, fromRrule, localDay, localTime, toRrule, weekday } from 'comun/agenda.ts';
import {
	daysName,
	MAX_SKIP_DAYS,
	type Alarm,
	type AlarmInput,
	type AlarmPlace
} from 'comun/alarms.ts';
import { alarm, alarmPerson, familyPerson } from '#lib/server/db/schema.ts';
import type { AnyDb } from '#lib/server/family-scope.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { tellHouse } from '#lib/server/house.ts';
import { notify } from '#lib/server/push.ts';
import { tellGroup } from '#lib/server/telegram/bot.ts';
import { toldOf } from '#lib/server/agenda/agenda.ts';
import { nextRing } from './next.ts';

/**
 * The family's alarms (#253; jellycartoon's #241): set in the Agenda or by the house's voice, for
 * the house or for some people. The cloud keeps their time; when it comes, it tells the house
 * (/api/v1/avisos), which rings them where they are to sound («din-don» and its name, again and
 * again) until someone stops them, there or here; and the phones of whom it is for (Web Push), and
 * the family's group if it is the house's (its Telegram bot).
 * The timers stay in the house: they last minutes and ring where they were set.
 */

/** A phone's notice of one ringing, no use after this: the house stops sounding by then. */
const RING_MAX_MS = 3 * 60_000;
/** Over this long, what is over is forgotten; told to the voice until then. */
const KEEP_DONE_MS = 30 * 60_000;

const listeners = new Map<string, Set<() => void>>();

/** The family's open Agendas and banners, told on every change. */
export function watchAlarms(familyId: string, listener: () => void) {
	const set = listeners.get(familyId) ?? new Set();
	set.add(listener);
	listeners.set(familyId, set);
	return () => void set.delete(listener);
}

function changed(familyId: string) {
	for (const listener of listeners.get(familyId) ?? []) listener();
}

const ms = (date: Date | null) => date?.getTime() ?? null;

type Row = typeof alarm.$inferSelect;

/** Who each is for: the family's people (agenda.ts). */
async function peopleOf(tx: AnyDb, ids: number[]) {
	const rows = ids.length
		? await tx.select().from(alarmPerson).where(inArray(alarmPerson.alarmId, ids))
		: [];
	return (id: number) => rows.filter((p) => p.alarmId === id).map((p) => String(p.personId));
}

/** The house's and those of `personId` (null: only the house's, as a satellite sees them). */
const visibleTo = (people: string[], personId: string | null) =>
	!people.length || (personId !== null && people.includes(personId));

function asAlarm(r: Row, people: string[]): Alarm {
	const repeat = fromRrule(r.repeat);
	return {
		id: r.id,
		label: r.label,
		kind: 'alarma',
		endsAt: null,
		seconds: null,
		trigger: null,
		place: r.place as AlarmPlace,
		time: r.time.slice(0, 5),
		day: r.startDay,
		days: repeat.every === 'semana' ? repeat.days : [],
		paused: r.paused,
		nextAt: ms(r.nextAt),
		ringingSince: ms(r.ringingSince),
		doneAt: ms(r.doneAt),
		people,
		by: r.userId
	};
}

/**
 * The house's and those of this person (`personId`, agenda.ts). Not those over (rung and stopped,
 * not coming again): kept a while only for the voice (`describeAlarms`).
 */
export function listAlarms(k: Kitchen, personId: string | null): Promise<Alarm[]> {
	return k.run(async (tx) => {
		const rows = await tx.select().from(alarm).orderBy(alarm.nextAt, alarm.id);
		const of = await peopleOf(
			tx,
			rows.map((r) => r.id)
		);
		return rows
			.filter((r) => !r.doneAt && visibleTo(of(r.id), personId))
			.map((r) => asAlarm(r, of(r.id)));
	});
}

/** Whether this person (null: the house) sees it, to change it: the house's, or theirs. */
export async function canTouch(k: Kitchen, id: number, personId: string | null) {
	return k.run(async (tx) => {
		const [row] = await tx.select({ id: alarm.id }).from(alarm).where(eq(alarm.id, id));
		if (!row) return false;
		return visibleTo((await peopleOf(tx, [id]))(id), personId);
	});
}

/** Only the family's people: an id that is not, left out. */
async function realPeople(tx: AnyDb, people: string[]) {
	const ids = people.map(Number).filter(Number.isInteger);
	if (!ids.length) return [];
	const rows = await tx
		.select({ id: familyPerson.id })
		.from(familyPerson)
		.where(inArray(familyPerson.id, ids));
	return rows.map((r) => r.id);
}

/** One for `people` (none, the house's), by the kitchen's person, from the Agenda or by voice. */
export async function addAlarm(k: Kitchen, input: Extract<AlarmInput, { kind: 'alarma' }>) {
	const repeat = input.days.length ? toRrule({ every: 'semana', days: input.days }) : null;
	const times = { time: input.time, startDay: input.day, repeat, skipDays: [] };
	const id = await k.run(async (tx) => {
		const [row] = await tx
			.insert(alarm)
			.values({
				familyId: k.familyId,
				label: input.label,
				place: input.place,
				userId: k.userId,
				...times,
				nextAt: nextRing(times)
			})
			.returning({ id: alarm.id });
		const people = await realPeople(tx, input.people);
		if (people.length)
			await tx
				.insert(alarmPerson)
				.values(people.map((personId) => ({ familyId: k.familyId, alarmId: row!.id, personId })));
		return row!.id;
	});
	console.info(`[avisos] Nueva: «${input.label}»`, { familyId: k.familyId, id });
	changed(k.familyId);
	return id;
}

export async function deleteAlarm(k: Kitchen, id: number) {
	const [gone] = await k.run((tx) =>
		tx.delete(alarm).where(eq(alarm.id, id)).returning({ ringing: alarm.ringingSince })
	);
	if (gone?.ringing) void quietAtHouse(k.familyId, id);
	changed(k.familyId);
}

/** Over now: not ringing, not coming again; kept a while for the voice («se quitó hace 2 min»). */
const quiet = {
	ringingSince: null,
	doneAt: sql`case when ${alarm.nextAt} is null then now() else ${alarm.doneAt} end`
};

/**
 * When each was stopped while ringing, for «posponer» (`snoozeAlarm`): saying «Alexa» stops it
 * before the order arrives. Only in memory: after a restart, nothing to put off.
 */
const stoppedAt = new Map<number, number>();
/** How long after stopping it may still be put off. */
const SNOOZE_AFTER_MS = 10 * 60_000;

const justStopped = (id: number) => Date.now() - (stoppedAt.get(id) ?? 0) < SNOOZE_AFTER_MS;

/**
 * «Parar»: the one ringing is quiet; one that does not come again is over. From here (the Agenda,
 * the banner, the voice), the house is told to stop sounding it; from the house, it already has.
 */
export async function stopAlarm(k: Kitchen, id: number, { fromHouse = false } = {}) {
	stoppedAt.set(id, Date.now());
	const [row] = await k.run((tx) =>
		tx
			.update(alarm)
			.set(quiet)
			.where(and(eq(alarm.id, id), isNotNull(alarm.ringingSince)))
			.returning({ id: alarm.id })
	);
	if (row && !fromHouse) void quietAtHouse(k.familyId, id);
	changed(k.familyId);
}

/** The house stops sounding it: stopped here, or gone. */
async function quietAtHouse(familyId: string, id: number) {
	await tellHouse(familyId, '/avisos/parar', { id }).catch((error) =>
		console.warn('[avisos] La casa no se enteró de que se ha parado', { id, error: String(error) })
	);
}

/**
 * The days from `from` to `to` (both in) on which it would ring, today or later: by its weekdays
 * if it repeats. Null if the range is not one.
 */
function ringDays(row: Row, from: string, to: string): string[] | null {
	const today = localDay();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from)
		return null;
	const repeat = fromRrule(row.repeat);
	const days: string[] = [];
	for (let day = from < today ? today : from; day <= to; day = addDays(day, 1)) {
		if (days.length >= MAX_SKIP_DAYS) return null;
		if (repeat.every !== 'semana' || repeat.days.includes(weekday(day))) days.push(day);
	}
	return days;
}

/** Saves the days skipped, the past ones forgotten, and when it rings next. */
async function setSkipDays(k: Kitchen, row: Row, skipDays: string[]) {
	const today = localDay();
	const kept = [...new Set(skipDays)].filter((day) => day >= today).sort();
	const nextAt = row.paused ? row.nextAt : nextRing({ ...row, skipDays: kept });
	await k.run((tx) => tx.update(alarm).set({ skipDays: kept, nextAt }).where(eq(alarm.id, row.id)));
	changed(k.familyId);
}

const rowOf = async (k: Kitchen, id: number) =>
	(await k.run((tx) => tx.select().from(alarm).where(eq(alarm.id, id))))[0];

/**
 * «Esta vez no»: its next day passed by; or, with `from` (and `to`, else only that day), those days
 * («el jueves no», «del 1 al 15 de agosto no»). The days skipped, or null if none can be.
 */
export async function skipAlarm(k: Kitchen, id: number, from?: string, to?: string) {
	const row = await rowOf(k, id);
	if (!row) return null;
	const days = from ? ringDays(row, from, to || from) : row.nextAt ? [localDay(row.nextAt)] : [];
	if (!days?.length) return null;
	await setSkipDays(k, row, [...row.skipDays, ...days]);
	return days;
}

/** «Al final mañana sí»: those days ring again. The days it was skipping among them. */
export async function unskipAlarm(k: Kitchen, id: number, from: string, to?: string) {
	const row = await rowOf(k, id);
	if (!row) return null;
	const days = ringDays(row, from, to || from);
	if (!days) return null;
	const back = row.skipDays.filter((day) => days.includes(day));
	await setSkipDays(
		k,
		row,
		row.skipDays.filter((day) => !back.includes(day))
	);
	return back;
}

/**
 * Its time, its weekdays (empty, once), its day if once, or its name, without taking it away
 * («cámbiala a las 6:30», «quítale el sábado»). What is not given stays. How it is now, in words;
 * null if it is not there.
 */
export async function editAlarm(
	k: Kitchen,
	id: number,
	changes: { time?: string; days?: number[]; day?: string; label?: string }
) {
	const row = await rowOf(k, id);
	if (!row) return null;
	const repeat =
		changes.days === undefined
			? row.repeat
			: changes.days.length
				? toRrule({ every: 'semana', days: changes.days })
				: null;
	const time = changes.time ?? row.time.slice(0, 5);
	// Once: the day said, its own if still to come, else today if its time has not passed, or tomorrow.
	const today = localDay();
	const startDay = repeat
		? row.startDay
		: (changes.day ??
			(row.startDay > today ? row.startDay : time > localTime() ? today : addDays(today, 1)));
	const times = { time, startDay, repeat, skipDays: row.skipDays };
	const values = {
		...times,
		label: changes.label ?? row.label,
		nextAt: row.paused ? row.nextAt : nextRing(times),
		// Changed to come again: not over any more.
		doneAt: null
	};
	await k.run((tx) => tx.update(alarm).set(values).where(eq(alarm.id, id)));
	console.info(`[avisos] Cambiada: «${values.label}»`, { id, ...changes });
	changed(k.familyId);
	const days = fromRrule(repeat);
	return `«${values.label}», a las ${time}, ${days.every === 'semana' ? daysName(days.days).toLowerCase() : 'una vez'}, ${row.paused ? 'pausada' : values.nextAt ? `la próxima ${whenSaid(values.nextAt)}` : 'no vuelve a sonar'}`;
}

/**
 * «Posponer»: the one ringing, or stopped a moment ago, rings again in `minutes`; its repetitions
 * stay as they were (after that ring, its next day). When, or null if it was not ringing.
 */
export async function snoozeAlarm(k: Kitchen, id: number, minutes: number) {
	const row = await rowOf(k, id);
	if (!row || (!row.ringingSince && !justStopped(id))) return null;
	const at = new Date(Date.now() + minutes * 60_000);
	await k.run((tx) =>
		tx
			.update(alarm)
			.set({ ringingSince: null, nextAt: at, doneAt: null, paused: false })
			.where(eq(alarm.id, id))
	);
	if (row.ringingSince) void quietAtHouse(k.familyId, id);
	stoppedAt.delete(id);
	console.info(`[avisos] Pospuesta ${minutes} min: «${row.label}»`, { id });
	changed(k.familyId);
	return at;
}

/** Kept, but not ringing; on again, from its next time after now. */
export async function setPaused(k: Kitchen, id: number, paused: boolean) {
	const row = await rowOf(k, id);
	if (!row) return;
	const nextAt = paused ? row.nextAt : nextRing(row);
	await k.run((tx) => tx.update(alarm).set({ paused, nextAt }).where(eq(alarm.id, id)));
	changed(k.familyId);
}

// ——— For the house's voice ———

/** «hoy a las 07:30», «mañana a las 07:30», «el 2026-10-30 a las 07:30». */
function whenSaid(at: Date) {
	const day = localDay(at);
	const today = localDay();
	const name = day === today ? 'hoy' : day === addDays(today, 1) ? 'mañana' : `el ${day}`;
	return `${name} a las ${localTime(at)}`;
}

/** «toda la casa», «el satélite Salón». */
export function placeName(place: string, satellites: { id: string; name: string }[]) {
	if (place === 'casa') return 'toda la casa';
	const id = place.slice('satelite:'.length);
	return `el satélite ${satellites.find((s) => s.id === id)?.name ?? '(ya no está)'}`;
}

/**
 * For the house's voice, with each order: the alarms it may see (the house's and, from a phone,
 * its person's), with their id to change them. `satellites`, the house's, to say where they sound.
 */
export async function describeAlarms(
	k: Kitchen,
	personId: string | null,
	satellites: { id: string; name: string }[]
) {
	const rows = await k.run(async (tx) => {
		const rows = await tx.select().from(alarm);
		const of = await peopleOf(
			tx,
			rows.map((r) => r.id)
		);
		return rows
			.filter((r) => !r.doneAt && visibleTo(of(r.id), personId))
			.map((r) => ({ ...r, people: of(r.id) }));
	});
	return rows.map((r) => {
		const days = fromRrule(r.repeat);
		const repeat = days.every === 'semana' ? daysName(days.days).toLowerCase() : 'una vez';
		const next = r.paused ? 'pausada' : r.nextAt ? `la próxima ${whenSaid(r.nextAt)}` : 'ya sonó';
		const who = r.people.length ? 'de una persona' : 'de la casa';
		const skipped = r.skipDays.filter((day) => day >= localDay());
		const skips = skipped.length
			? `; no suena ${skipped.length > 6 ? `${skipped.length} días, del ${skipped[0]} al ${skipped.at(-1)}` : skipped.join(', ')}`
			: '';
		return `[alarma ${r.id}] ${r.label}: a las ${r.time.slice(0, 5)}, ${repeat}, ${next}${skips}; ${who}; suena en ${placeName(r.place, satellites)}${r.ringingSince ? '; está sonando' : justStopped(r.id) ? '; acaba de sonar y la han parado (se puede posponer)' : ''}`;
	});
}

// ——— When it is time ———

/**
 * A family's whose time has come, from the cloud's clock (scheduler.ts): ringing in the house, or
 * the house's music stopped; their next time, if they repeat. What is over, forgotten.
 */
export async function ringDue(k: Kitchen) {
	const now = new Date();
	const rows = await k.run((tx) =>
		tx
			.select()
			.from(alarm)
			.where(and(lte(alarm.nextAt, now), eq(alarm.paused, false)))
	);
	for (const row of rows) {
		const next = row.repeat ? nextRing(row, new Date(now.getTime() + 1000)) : null;
		const stops = row.action === 'parar_musica';
		// Claimed first: rung once, though two servers looked at the same moment.
		const claimed = await k.run((tx) =>
			tx
				.update(alarm)
				.set({
					nextAt: next,
					ringingSince: stops ? null : now,
					doneAt: stops && !next ? now : row.doneAt
				})
				.where(and(eq(alarm.id, row.id), eq(alarm.nextAt, row.nextAt!)))
				.returning({ id: alarm.id })
		);
		if (!claimed.length) continue;
		console.info(`[avisos] ${stops ? 'Para la música' : 'Suena'}: «${row.label}»`, {
			familyId: k.familyId,
			place: row.place
		});
		void ringAtHouse(k, row).catch((error) => console.warn('[avisos] Al avisar', error));
	}
	await k.run((tx) =>
		tx.delete(alarm).where(lte(alarm.doneAt, new Date(now.getTime() - KEEP_DONE_MS)))
	);
	if (rows.length) changed(k.familyId);
}

/**
 * The house rings it (or stops its music), and says where; and the phones of whom it is for, or of
 * everyone if it is the house's, are told, with the app closed (Web Push). With the app open, the
 * banner says it.
 */
async function ringAtHouse(k: Kitchen, row: Row) {
	let where: string;
	try {
		({ where } = await tellHouse<{ where: string }>(k.familyId, '/avisos', {
			id: row.id,
			label: row.label,
			place: row.place,
			action: row.action
		}));
	} catch (error) {
		console.warn('[avisos] La casa no contesta', { id: row.id, error: String(error) });
		where = 'la casa, que no contesta';
	}
	if (row.action === 'parar_musica') return;
	const people = await k.run(async (tx) => (await peopleOf(tx, [row.id]))(row.id));
	await notify(k.familyId, await toldOf(k, people), {
		title: `⏰ ${row.label}`,
		body: `Sonando en ${where}`,
		tag: `alarma-${row.id}`,
		url: '/agenda#alarmas',
		// Later, it has stopped sounding: no use.
		ttl: RING_MAX_MS / 1000
	});
	// The house's, to the family's group too (its bot).
	if (!people.length) await tellGroup(k.familyId, 'alarmas', `⏰ Suena: ${row.label}`);
}
