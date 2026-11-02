import { and, eq, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Alarm, AlarmPlace } from 'comun/alarms.ts';
import { describeTimers, sameLabel, timeLabel } from 'comun/timer-names.ts';
import { db } from '#lib/server/db/index.ts';
import { alarm, alarmPerson } from '#lib/server/db/schema.ts';
import { cloudAlarmStopped, tellGroup } from '#lib/server/kitchen.ts';
import { log } from '#lib/server/log.ts';
import {
	controlSnapcast,
	sayOnSnapcast,
	snapcastVoiceReady,
	stopAfterTrackOnSnapcast
} from '#lib/server/music/snapcast.ts';
import { houseSpeech } from '#lib/server/voice/house-speech.ts';

/**
 * The house's timers (#241), kept by the server: set by voice (one of Seilide's satellites, with
 * the house's hands), and rung when it is time: «din-don» and its name, again and again, until
 * someone stops it (or for `RING_MAX_MS`), in the whole house through Snapcast. The satellites are
 * Seilide's (#329): they ring their own there.
 *
 * The alarms are the family's, in the cloud (#253): it keeps their time and, when it comes, tells
 * the house (/api/v1/avisos), which rings them here as a row of its own (`cloudId`) until someone
 * stops them, here (and the cloud is told) or there (and the house is told).
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

/** The open Agendas and banners, told on every change. */
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

/**
 * Its own and the house's: the ones for nobody, or for them among others (the cloud's alarms
 * ringing here, the house's). Not those over (rung and stopped, not coming again): kept a while
 * only for the AI (`describeTimersAt`).
 */
export async function listAlarms(userId: string): Promise<Alarm[]> {
	const rows = await db.select().from(alarm).orderBy(alarm.nextAt, alarm.id);
	const of = await peopleOf(rows.map((r) => r.id));
	return rows
		.filter((r) => !r.doneAt)
		.filter((r) => {
			const theirs = of(r.id);
			return !theirs.length || theirs.includes(userId);
		})
		.map((r) => ({
			id: r.id,
			label: r.label,
			kind: r.kind,
			endsAt: ms(r.endsAt),
			seconds: r.seconds,
			trigger: r.trigger,
			place: r.place as AlarmPlace,
			time: null,
			day: null,
			days: [],
			paused: false,
			nextAt: ms(r.nextAt),
			ringingSince: ms(r.ringingSince),
			doneAt: ms(r.doneAt),
			people: of(r.id),
			by: r.userId
		}));
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

/** Over now: not ringing, not coming again; kept a while for the AI («se quitó hace 2 min»). */
const over = () => ({ ringingSince: null, nextAt: null, doneAt: new Date() });

/** The cloud's among these, told they were stopped here: it may put them off («posponer»). */
function tellCloud(rows: { cloudId: number | null }[]) {
	for (const { cloudId } of rows) if (cloudId !== null) void cloudAlarmStopped(cloudId);
}

/** «Parar»: the one ringing is quiet, and over; the cloud's, told to the cloud. */
export async function stopAlarm(id: number) {
	const stopped = await db
		.update(alarm)
		.set({
			ringingSince: null,
			doneAt: sql`case when ${alarm.nextAt} is null then now() else ${alarm.doneAt} end`
		})
		.where(eq(alarm.id, id))
		.returning({ cloudId: alarm.cloudId });
	tellCloud(stopped);
	changed();
}

/** Whether `userId` sees it, to stop it: the house's, or theirs. */
export async function canTouch(id: number, userId: string) {
	const people = await db.select().from(alarmPerson).where(eq(alarmPerson.alarmId, id));
	return !people.length || people.some((p) => p.userId === userId);
}

// ——— The cloud's alarms (#253) ———

/**
 * One of the family's alarms whose time has come, told by the cloud: it rings here, as a row of
 * its own, until stopped (here or there); or the music stops. Where it sounds, in words.
 */
export async function ringFromCloud(ring: {
	id: number;
	label: string;
	place: AlarmPlace;
	action: 'sonar' | 'parar_musica';
}) {
	const where = placeName(ring.place);
	if (ring.action === 'parar_musica') {
		log.info('avisos', `Para la música: «${ring.label}»`);
		if (!(await stopAfterTrackOnSnapcast().catch(() => false)))
			await controlSnapcast({ action: 'stop' }).catch(() => {});
		return where;
	}
	// The same one again (put off, or the cloud asking twice): only once.
	await db.delete(alarm).where(eq(alarm.cloudId, ring.id));
	await db.insert(alarm).values({
		label: ring.label,
		kind: 'alarma',
		place: ring.place,
		cloudId: ring.id,
		ringingSince: new Date()
	});
	log.info('avisos', `Suena: «${ring.label}»`, { place: ring.place, cloudId: ring.id });
	changed();
	void ringServer();
	return where;
}

/** Stopped in the cloud (its Agenda, a phone, put off), or gone there: quiet here too. */
export async function quietFromCloud(cloudId: number) {
	await db.update(alarm).set(over()).where(eq(alarm.cloudId, cloudId));
	changed();
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
 * For the AI, with each order said to a satellite: its timers, as the phone's are told
 * (describeTimers). The family's alarms are told by the cloud, where the AI is (#253).
 */
export async function describeTimersAt(place: AlarmPlace) {
	const now = Date.now();
	const rows = await db.select().from(alarm);
	const timers = rows.filter((r) => r.place === place && r.kind !== 'alarma');
	return describeTimers(
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
}

/** «toda la casa», «el móvil»; a satellite's (Seilide's: the house does not know its name) is heard in the whole house. */
export function placeName(place: string) {
	if (place === 'movil') return 'el móvil';
	return 'toda la casa';
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
		.where(isNotNull(alarm.nextAt))
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
	const rows = await db.select().from(alarm).where(lte(alarm.nextAt, now));
	for (const row of rows) {
		await db.update(alarm).set({ nextAt: null, ringingSince: now }).where(eq(alarm.id, row.id));
		log.info('avisos', `Suena: «${row.label}»`, { place: row.place });
		void tellRinging(row).catch((error) => log.warn('avisos', 'Al avisar', { error }));
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

/** A house's timer (for nobody), to the family's group too (its Telegram bot, in the cloud). */
async function tellRinging(row: Row) {
	const people = await db
		.select({ id: alarmPerson.userId })
		.from(alarmPerson)
		.where(eq(alarmPerson.alarmId, row.id));
	if (!people.length) await tellGroup(`⏰ Suena: ${row.label}`);
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

let ringing = false;

/**
 * The ringing ones the server says itself, through Snapcast over the music: «din-don» and their
 * names, together, with a pause, until all are stopped or have rung for `RING_MAX_MS`.
 */
async function ringServer() {
	if (ringing) return;
	ringing = true;
	try {
		for (;;) {
			const labels = (await sounding()).map((r) => r.label);
			if (!labels.length) break;
			if (!snapcastVoiceReady()) {
				log.warn('avisos', 'Sin Snapcast con voz: no puede sonar en la casa');
				break;
			}
			const words = `Aviso: ${labels.join(' y ')}.`;
			await sayOnSnapcast(await houseSpeech(words, { chime: true }), 'house');
			await sleep(RING_PAUSE_MS);
		}
	} catch (error) {
		log.error('avisos', 'No se pudo sonar', { error });
	} finally {
		ringing = false;
	}
}
