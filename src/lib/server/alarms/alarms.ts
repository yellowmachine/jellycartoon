import { and, eq, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import { setTimeout as sleep } from 'node:timers/promises';
import { daysName, type Alarm, type AlarmInput, type AlarmPlace } from '#lib/alarms.ts';
import { addDays, fromRrule, localDay, localTime, toRrule, weekday } from '#lib/agenda.ts';
import { describeTimers, sameLabel, timeLabel } from '#lib/timer-names.ts';
import { db } from '#lib/server/db/index.ts';
import { alarm, alarmPerson } from '#lib/server/db/schema.ts';
import { log } from '#lib/server/log.ts';
import {
	controlSnapcast,
	sayOnSnapcast,
	snapcastVoiceReady,
	stopAfterTrackOnSnapcast
} from '#lib/server/music/snapcast.ts';
import { allSatellites, type Satellite } from '#lib/server/satellites.ts';
import { tellGroup } from '#lib/server/telegram/bot.ts';
import { houseSpeech } from '#lib/server/voice/house-speech.ts';
import { nextRing } from './next.ts';

/**
 * Alarms and timers (#241), kept by the server: set by hand in the Agenda or by voice, for the
 * house or for some people, and rung where they are to sound when it is time: «din-don» and its
 * name, again and again, until someone stops it (or for `RING_MAX_MS`). In the whole house through
 * Snapcast; in a voice satellite, where it answers: through Snapcast too if it answers there, the
 * server saying it, or on its own speaker, the satellite told through its channel (/api/satelite/avisos).
 */

/** Ringing this long, it stops sounding (it still shows): no one is there. As the phone's. */
const RING_MAX_MS = 3 * 60_000;
/** Between each «din-don» and its words. */
const RING_PAUSE_MS = 5000;
/** Over this long, what is over is forgotten; told to the AI until then. */
const KEEP_DONE_MS = 30 * 60_000;
/** A prepared one never started, forgotten after this long. */
const KEEP_PREPARED_MS = 12 * 3600_000;
/** Looked at again at least this often: a clock changed, a row changed by hand. */
const CHECK_MS = 60_000;
/** What the AI may still call one with no name: as if it had none (as timers.svelte.ts). */
const DEFAULT_LABEL = 'temporizador';

const listeners = new Set<() => void>();

/** The open Agendas and the satellites' channels, told on every change. */
export function watchAlarms(listener: () => void) {
	listeners.add(listener);
	return () => void listeners.delete(listener);
}

function changed() {
	for (const listener of listeners) listener();
}

const ms = (date: Date | null) => date?.getTime() ?? null;

type Row = typeof alarm.$inferSelect;

/** Who each is for. */
async function peopleOf(ids: number[]) {
	const rows = ids.length
		? await db.select().from(alarmPerson).where(inArray(alarmPerson.alarmId, ids))
		: [];
	return (id: number) => rows.filter((p) => p.alarmId === id).map((p) => p.userId);
}

/** Its own and the house's: the ones for nobody, or for them among others. */
export async function listAlarms(userId: string): Promise<Alarm[]> {
	const rows = await db.select().from(alarm).orderBy(alarm.nextAt, alarm.id);
	const of = await peopleOf(rows.map((r) => r.id));
	return rows
		.filter((r) => {
			const theirs = of(r.id);
			return !theirs.length || theirs.includes(userId);
		})
		.map((r) => {
			const repeat = fromRrule(r.repeat);
			return {
				id: r.id,
				label: r.label,
				kind: r.kind,
				endsAt: ms(r.endsAt),
				seconds: r.seconds,
				trigger: r.trigger,
				place: r.place as AlarmPlace,
				time: r.time?.slice(0, 5) ?? null,
				day: r.startDay,
				days: repeat.every === 'semana' ? repeat.days : [],
				paused: r.paused,
				nextAt: ms(r.nextAt),
				ringingSince: ms(r.ringingSince),
				doneAt: ms(r.doneAt),
				people: of(r.id),
				by: r.userId
			};
		});
}

async function insert(values: typeof alarm.$inferInsert, people: string[]) {
	const [row] = await db.insert(alarm).values(values).returning({ id: alarm.id });
	if (people.length)
		await db
			.insert(alarmPerson)
			.values(people.map((person) => ({ alarmId: row!.id, userId: person })));
	log.info('avisos', `Nuevo: «${values.label}»`, { ...values, people });
	await schedule();
	changed();
	return row!.id;
}

/** One for `people` (none, the house's), by `userId`, from the Agenda or by voice. */
export async function addAlarm(userId: string | null, input: AlarmInput) {
	const now = new Date();
	const base = { label: input.label, kind: input.kind, userId, place: input.place };
	if (input.kind === 'temporizador') {
		const endsAt = new Date(now.getTime() + input.minutes * 60_000);
		return insert({ ...base, endsAt, nextAt: endsAt }, input.people);
	}
	const repeat = input.days.length ? toRrule({ every: 'semana', days: input.days }) : null;
	const times = { time: input.time, startDay: input.day, repeat, skipDays: [] };
	return insert({ ...base, ...times, nextAt: nextRing(times, now) }, input.people);
}

export async function deleteAlarm(id: number) {
	await db.delete(alarm).where(eq(alarm.id, id));
	await schedule();
	changed();
}

/** Over now: not ringing, not coming again; kept a while for the AI («se quitó hace 2 min»). */
const over = () => ({ ringingSince: null, nextAt: null, doneAt: new Date() });

/** «Parar»: the one ringing is quiet; one that does not come again is over. */
export async function stopAlarm(id: number) {
	await db
		.update(alarm)
		.set({
			ringingSince: null,
			doneAt: sql`case when ${alarm.nextAt} is null then now() else ${alarm.doneAt} end`
		})
		.where(eq(alarm.id, id));
	changed();
}

/**
 * «Hola casita» (or «Alexa») while something rings where a satellite is: what rings in it and in
 * the whole house stops, as touching the phone stops its timers. How many.
 */
export async function stopRingingAt(place: AlarmPlace) {
	const stopped = await db
		.update(alarm)
		.set({
			ringingSince: null,
			doneAt: sql`case when ${alarm.nextAt} is null then now() else ${alarm.doneAt} end`
		})
		.where(and(isNotNull(alarm.ringingSince), inArray(alarm.place, [place, 'casa'])))
		.returning({ label: alarm.label });
	if (stopped.length) {
		log.info('avisos', `Parados: ${stopped.map((s) => `«${s.label}»`).join(', ')}`, { place });
		changed();
	}
	return stopped.length;
}

/** Most days skipped or unskipped at once: a long holiday. */
export const MAX_SKIP_DAYS = 92;

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
async function setSkipDays(row: Row, skipDays: string[]) {
	const today = localDay();
	const kept = [...new Set(skipDays)].filter((day) => day >= today).sort();
	const nextAt =
		row.paused || !row.time || !row.startDay
			? row.nextAt
			: nextRing({ ...row, time: row.time, startDay: row.startDay, skipDays: kept });
	await db.update(alarm).set({ skipDays: kept, nextAt }).where(eq(alarm.id, row.id));
	await schedule();
	changed();
}

/**
 * «Esta vez no»: its next day passed by; or, with `from` (and `to`, else only that day), those days
 * («el jueves no», «del 1 al 15 de agosto no»). The days skipped, or null if none can be.
 */
export async function skipAlarm(id: number, from?: string, to?: string) {
	const [row] = await db.select().from(alarm).where(eq(alarm.id, id));
	if (!row?.time || !row.startDay) return null;
	const days = from ? ringDays(row, from, to || from) : row.nextAt ? [localDay(row.nextAt)] : [];
	if (!days?.length) return null;
	await setSkipDays(row, [...row.skipDays, ...days]);
	return days;
}

/** «Al final mañana sí»: those days ring again. The days it was skipping among them. */
export async function unskipAlarm(id: number, from: string, to?: string) {
	const [row] = await db.select().from(alarm).where(eq(alarm.id, id));
	if (!row?.time || !row.startDay) return null;
	const days = ringDays(row, from, to || from);
	if (!days) return null;
	const back = row.skipDays.filter((day) => days.includes(day));
	await setSkipDays(
		row,
		row.skipDays.filter((day) => !back.includes(day))
	);
	return back;
}

/**
 * Its time, its weekdays (empty, once), its day if once, or its name, without taking it away
 * («cámbiala a las 6:30», «quítale el sábado»). What is not given stays. How it is now, in words;
 * null if it is not an alarm.
 */
export async function editAlarm(
	id: number,
	changes: { time?: string; days?: number[]; day?: string; label?: string }
) {
	const [row] = await db.select().from(alarm).where(eq(alarm.id, id));
	if (!row || row.kind !== 'alarma' || !row.time || !row.startDay) return null;
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
	await db.update(alarm).set(values).where(eq(alarm.id, id));
	log.info('avisos', `Cambiado: «${values.label}»`, { id, ...changes });
	await schedule();
	changed();
	const days = fromRrule(repeat);
	return `«${values.label}», a las ${time}, ${days.every === 'semana' ? daysName(days.days).toLowerCase() : 'una vez'}, ${row.paused ? 'pausada' : values.nextAt ? `la próxima ${whenSaid(values.nextAt)}` : 'no vuelve a sonar'}`;
}

/** Kept, but not ringing; on again, from its next time after now. */
export async function setPaused(id: number, paused: boolean) {
	const [row] = await db.select().from(alarm).where(eq(alarm.id, id));
	if (!row) return;
	const nextAt =
		paused || row.kind !== 'alarma' || !row.time || !row.startDay
			? row.nextAt
			: nextRing({ ...row, time: row.time, startDay: row.startDay });
	await db.update(alarm).set({ paused, nextAt }).where(eq(alarm.id, id));
	await schedule();
	changed();
}

/** Whether `userId` sees it, to change it: the house's, or theirs. */
export async function canTouch(id: number, userId: string) {
	const people = await db.select().from(alarmPerson).where(eq(alarmPerson.alarmId, id));
	return !people.length || people.some((p) => p.userId === userId);
}

// ——— By voice, where it is said (#241, phase 2) ———

/** The timers there: counting, prepared, ringing, or over a while ago. */
async function timersAt(place: AlarmPlace) {
	return db
		.select()
		.from(alarm)
		.where(and(eq(alarm.place, place), inArray(alarm.kind, ['temporizador', 'preparado'])));
}

const active = (r: Row) => !r.doneAt;

/**
 * The name it goes by there, as the phone's timers (timers.svelte.ts): without one, its time
 * («5 minutos»), and «5 minutos (2)» if that one is taken; with one, as said, so that «pon 10
 * minutos para la pasta» again starts the pasta's over.
 */
function nameFor(rows: Row[], label: string, seconds: number) {
	label = label.trim();
	if (label && !sameLabel(label, DEFAULT_LABEL)) return label;
	const base = timeLabel(seconds);
	const taken = (name: string) => rows.some((r) => active(r) && sameLabel(r.label, name));
	let name = base;
	for (let n = 2; taken(name); n++) name = `${base} (${n})`;
	return name;
}

/** Those with that name there, out of the way: the new one replaces them. */
async function replace(rows: Row[], label: string) {
	const same = rows.filter((r) => active(r) && sameLabel(r.label, label)).map((r) => r.id);
	if (same.length) await db.delete(alarm).where(inArray(alarm.id, same));
}

/** «Avísame en 10 minutos para la pasta»: one with the same name starts over; a prepared one starts. */
export async function startTimerAt(
	place: AlarmPlace,
	{
		label,
		seconds,
		userId,
		people = []
	}: { label: string; seconds: number; userId: string | null; people?: string[] }
) {
	const rows = await timersAt(place);
	const name = nameFor(rows, label, seconds);
	await replace(rows, name);
	const endsAt = new Date(Date.now() + seconds * 1000);
	await insert(
		{ label: name, kind: 'temporizador', place, userId, endsAt, nextAt: endsAt },
		people
	);
	return name;
}

/** «Cuando hierva, pon 8 minutos para la pasta»: waiting, started by voice later (`startTimerAt`). */
export async function prepareTimerAt(
	place: AlarmPlace,
	{
		label,
		seconds,
		trigger,
		userId
	}: { label: string; seconds: number; trigger: string; userId: string | null }
) {
	const rows = await timersAt(place);
	const name = nameFor(rows, label, seconds);
	await replace(rows, name);
	await insert({ label: name, kind: 'preparado', place, userId, seconds, trigger }, []);
	return name;
}

/** That one by its name, or all of them with null: counting, prepared or ringing. How many. */
export async function cancelTimersAt(place: AlarmPlace, label: string | null) {
	const rows = (await timersAt(place)).filter(
		(r) => active(r) && (label === null || sameLabel(r.label, label))
	);
	if (rows.length)
		await db
			.update(alarm)
			.set(over())
			.where(
				inArray(
					alarm.id,
					rows.map((r) => r.id)
				)
			);
	await schedule();
	changed();
	return rows.length;
}

/**
 * For the AI, with each order: the timers there, as the phone's are told (describeTimers), and the
 * alarms it may see (the house's and, from a phone, its person's), with their id to take them
 * away. `place`, a satellite's, whose timers these are; null, a phone's (its own, in the browser).
 */
export async function describeAlarms(place: AlarmPlace | null, userId: string | null) {
	const now = Date.now();
	const rows = await db.select().from(alarm);
	const of = await peopleOf(rows.map((r) => r.id));
	const timers = place ? rows.filter((r) => r.place === place && r.kind !== 'alarma') : [];
	const timerLines = describeTimers(
		{
			done: timers
				.filter((r) => r.doneAt && r.kind === 'temporizador')
				.map((r) => ({
					label: r.label,
					// Over before its end: taken away; at it or after, it rang.
					how: r.endsAt && r.doneAt! < r.endsAt ? 'quitado' : 'sonó',
					at: r.doneAt!.getTime()
				})),
			running: timers
				.filter((r) => active(r) && r.kind === 'temporizador' && !r.ringingSince && r.endsAt)
				.map((r) => ({ label: r.label, endsAt: r.endsAt!.getTime() })),
			ringing: timers.filter((r) => active(r) && r.ringingSince),
			prepared: timers
				.filter((r) => active(r) && r.kind === 'preparado')
				.map((r) => ({ label: r.label, seconds: r.seconds ?? 0, trigger: r.trigger ?? '' }))
		},
		now
	);
	const satellites = await allSatellites();
	const alarmLines = rows
		.filter((r) => r.kind === 'alarma' && !r.doneAt)
		.filter((r) => {
			const theirs = of(r.id);
			return !theirs.length || (userId !== null && theirs.includes(userId));
		})
		.map((r) => {
			const days = fromRrule(r.repeat);
			const repeat = days.every === 'semana' ? daysName(days.days).toLowerCase() : 'una vez';
			const next = r.paused ? 'pausada' : r.nextAt ? `la próxima ${whenSaid(r.nextAt)}` : 'ya sonó';
			const who = of(r.id).length ? 'de una persona' : 'de la casa';
			const skipped = r.skipDays.filter((day) => day >= localDay());
			const skips = skipped.length
				? `; no suena ${skipped.length > 6 ? `${skipped.length} días, del ${skipped[0]} al ${skipped.at(-1)}` : skipped.join(', ')}`
				: '';
			return `[alarma ${r.id}] ${r.label}: a las ${r.time?.slice(0, 5)}, ${repeat}, ${next}${skips}; ${who}; suena en ${placeName(r.place, satellites)}${r.ringingSince ? '; está sonando' : ''}`;
		});
	return [...timerLines, ...alarmLines];
}

/** «hoy a las 07:30», «mañana a las 07:30», «el 2026-10-30 a las 07:30». */
function whenSaid(at: Date) {
	const day = localDay(at);
	const today = localDay();
	const name = day === today ? 'hoy' : day === addDays(today, 1) ? 'mañana' : `el ${day}`;
	return `${name} a las ${localTime(at)}`;
}

/** «toda la casa», «el satélite Salón». */
export function placeName(place: string, satellites: Satellite[]) {
	if (place === 'casa') return 'toda la casa';
	const id = place.slice('satelite:'.length);
	return `el satélite ${satellites.find((s) => s.id === id)?.name ?? '(ya no está)'}`;
}

// ——— When it is time ———

let timer: ReturnType<typeof setTimeout> | undefined;

/** At startup: what came due while it was off rings now. */
export function startAlarms() {
	void schedule().then(() => ringServer());
}

/** Woken at the next one due (or in a minute at most, whatever happens meanwhile). */
async function schedule() {
	clearTimeout(timer);
	const [next] = await db
		.select({ at: alarm.nextAt })
		.from(alarm)
		.where(and(isNotNull(alarm.nextAt), eq(alarm.paused, false)))
		.orderBy(alarm.nextAt)
		.limit(1);
	const wait = next?.at ? Math.max(0, next.at.getTime() - Date.now()) : CHECK_MS;
	timer = setTimeout(
		() => void due().catch((error) => log.error('avisos', 'Al sonar', { error })),
		Math.min(wait, CHECK_MS)
	);
}

/** Those whose time has come: ringing, or the music stopped; their next time, if they repeat. */
async function due() {
	const now = new Date();
	const rows = await db
		.select()
		.from(alarm)
		.where(and(lte(alarm.nextAt, now), eq(alarm.paused, false)));
	for (const row of rows) {
		const next =
			row.kind === 'alarma' && row.repeat && row.time && row.startDay
				? nextRing(
						{ ...row, time: row.time, startDay: row.startDay },
						new Date(now.getTime() + 1000)
					)
				: null;
		const stops = row.action === 'parar_musica';
		await db
			.update(alarm)
			.set({
				nextAt: next,
				ringingSince: stops ? null : now,
				doneAt: stops && !next ? now : row.doneAt
			})
			.where(eq(alarm.id, row.id));
		log.info('avisos', stops ? `Para la música: «${row.label}»` : `Suena: «${row.label}»`, {
			place: row.place
		});
		if (stops && !(await stopAfterTrackOnSnapcast().catch(() => false)))
			await controlSnapcast({ action: 'stop' }).catch(() => {});
		// The house's, to the family's group too (Telegram's bot, #243): someone's own, not.
		if (!stops && !(await db.$count(alarmPerson, eq(alarmPerson.alarmId, row.id))))
			void tellGroup('avisos', `⏰ Suena: ${row.label}`);
	}
	// What is over (stopped, and not coming again) and prepared ones never started, forgotten.
	await db
		.delete(alarm)
		.where(
			or(
				lte(alarm.doneAt, new Date(now.getTime() - KEEP_DONE_MS)),
				and(
					eq(alarm.kind, 'preparado'),
					lte(alarm.createdAt, new Date(now.getTime() - KEEP_PREPARED_MS))
				)
			)
		);
	if (rows.length) {
		changed();
		void ringServer();
	}
	await schedule();
}

/**
 * Where it is said: through Snapcast (the whole house, or a satellite's speaker if it answers
 * there), by the server; or by a satellite on its own speaker (`satellite`), told by its channel.
 */
type Target = { snapcast: 'house' | string } | { satellite: string };

function targetOf(place: string, satellites: Satellite[]): Target {
	if (place === 'casa') return { snapcast: 'house' };
	const satellite = satellites.find((s) => `satelite:${s.id}` === place);
	// Gone: the house hears it all the same.
	if (!satellite) return { snapcast: 'house' };
	if (satellite.answerOn && snapcastVoiceReady()) return { snapcast: satellite.answerOn };
	return { satellite: satellite.id };
}

/** Those ringing, and for less than `RING_MAX_MS`: to be heard. */
async function sounding() {
	const now = Date.now();
	return (
		await db
			.select({ label: alarm.label, place: alarm.place, since: alarm.ringingSince })
			.from(alarm)
			.where(isNotNull(alarm.ringingSince))
	).filter((r) => now - r.since!.getTime() < RING_MAX_MS);
}

/**
 * What a satellite's channel says: what rings where it is (in it, or in the whole house), which
 * «hola casita» stops; and of those, what it has to say itself, on its own speaker.
 */
export async function ringingFor(satelliteId: string) {
	const place = `satelite:${satelliteId}`;
	const satellites = await allSatellites();
	const rows = (await sounding()).filter((r) => r.place === place || r.place === 'casa');
	const itself = rows.filter((r) => {
		const target = targetOf(r.place, satellites);
		return 'satellite' in target && target.satellite === satelliteId;
	});
	return { ringing: rows.map((r) => r.label), play: itself.map((r) => r.label) };
}

let ringing = false;

/**
 * The ringing ones the server says itself, through Snapcast over the music: «din-don» and their
 * names, each place's together, with a pause, until all are stopped or have rung for
 * `RING_MAX_MS`. A satellite on its own speaker rings by itself (`ringingFor`).
 */
async function ringServer() {
	if (ringing) return;
	ringing = true;
	try {
		for (;;) {
			const satellites = await allSatellites();
			const byTarget = new Map<string, string[]>();
			for (const r of await sounding()) {
				const target = targetOf(r.place, satellites);
				if (!('snapcast' in target)) continue;
				byTarget.set(target.snapcast, [...(byTarget.get(target.snapcast) ?? []), r.label]);
			}
			if (!byTarget.size) break;
			if (!snapcastVoiceReady()) {
				log.warn('avisos', 'Sin Snapcast con voz: no puede sonar en la casa');
				break;
			}
			for (const [where, labels] of byTarget) {
				const words = `Aviso: ${labels.join(' y ')}.`;
				await sayOnSnapcast(await houseSpeech(words, { chime: true }), where);
			}
			await sleep(RING_PAUSE_MS);
		}
	} catch (error) {
		log.error('avisos', 'No se pudo sonar', { error });
	} finally {
		ringing = false;
	}
}
