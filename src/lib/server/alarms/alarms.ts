import { and, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { setTimeout as sleep } from 'node:timers/promises';
import { fromRrule, localDay, toRrule } from '#lib/agenda.ts';
import type { Alarm, AlarmInput } from '#lib/alarms.ts';
import { db } from '#lib/server/db/index.ts';
import { alarm, alarmPerson } from '#lib/server/db/schema.ts';
import { log } from '#lib/server/log.ts';
import {
	controlSnapcast,
	sayOnSnapcast,
	snapcastVoiceReady,
	stopAfterTrackOnSnapcast
} from '#lib/server/music/snapcast.ts';
import { houseSpeech } from '#lib/server/voice/house-speech.ts';
import { nextRing } from './next.ts';

/**
 * Alarms and timers (#241), kept by the server: set by hand in the Agenda (and, later, by voice),
 * for the house or for some people, and rung where they are to sound when it is time. For now
 * that is the whole house, through Snapcast: «din-don» and its name, again and again, until
 * someone stops it in the Agenda (or for `RING_MAX_MS`).
 */

/** Ringing this long, it stops sounding (it still shows): no one is there. As the phone's. */
const RING_MAX_MS = 3 * 60_000;
/** Between each «din-don» and its words. */
const RING_PAUSE_MS = 5000;
/** Over this long, what is over is forgotten. */
const KEEP_DONE_MS = 30 * 60_000;
/** Looked at again at least this often: a clock changed, a row changed by hand. */
const CHECK_MS = 60_000;

const listeners = new Set<() => void>();

/** The open Agendas, told on every change: one set, one ringing, one stopped. */
export function watchAlarms(listener: () => void) {
	listeners.add(listener);
	return () => void listeners.delete(listener);
}

function changed() {
	for (const listener of listeners) listener();
}

const ms = (date: Date | null) => date?.getTime() ?? null;

/** Its own and the house's: the ones for nobody, or for them among others. */
export async function listAlarms(userId: string): Promise<Alarm[]> {
	const rows = await db.select().from(alarm).orderBy(alarm.nextAt, alarm.id);
	const people = await db.select().from(alarmPerson);
	const of = (id: number) => people.filter((p) => p.alarmId === id).map((p) => p.userId);
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

/** One for `people` (none, the house's), by `userId`. */
export async function addAlarm(userId: string | null, input: AlarmInput) {
	const now = new Date();
	const values =
		input.kind === 'temporizador'
			? {
					endsAt: new Date(now.getTime() + input.minutes * 60_000),
					nextAt: new Date(now.getTime() + input.minutes * 60_000)
				}
			: (() => {
					const repeat = input.days.length ? toRrule({ every: 'semana', days: input.days }) : null;
					const times = { time: input.time, startDay: input.day, repeat, skipDays: [] };
					return { ...times, nextAt: nextRing(times, now) };
				})();
	const [row] = await db
		.insert(alarm)
		.values({ label: input.label, kind: input.kind, userId, ...values })
		.returning({ id: alarm.id });
	if (input.people.length)
		await db
			.insert(alarmPerson)
			.values(input.people.map((person) => ({ alarmId: row!.id, userId: person })));
	log.info('avisos', `Nuevo: «${input.label}»`, { ...input });
	await schedule();
	changed();
	return row!.id;
}

export async function deleteAlarm(id: number) {
	await db.delete(alarm).where(eq(alarm.id, id));
	await schedule();
	changed();
}

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

/** «Esta vez no»: its next day passed by. */
export async function skipNext(id: number) {
	const [row] = await db.select().from(alarm).where(eq(alarm.id, id));
	if (!row?.time || !row.startDay || !row.nextAt) return;
	const skipDays = [...row.skipDays, localDay(row.nextAt)];
	const nextAt = nextRing({ ...row, time: row.time, startDay: row.startDay, skipDays });
	await db.update(alarm).set({ skipDays, nextAt }).where(eq(alarm.id, id));
	await schedule();
	changed();
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

let timer: ReturnType<typeof setTimeout> | undefined;

/** At startup: what came due while it was off rings now. */
export function startAlarms() {
	void schedule();
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
		log.info('avisos', stops ? `Para la música: «${row.label}»` : `Suena: «${row.label}»`);
		if (stops && !(await stopAfterTrackOnSnapcast().catch(() => false)))
			await controlSnapcast({ action: 'stop' }).catch(() => {});
	}
	// What is over (stopped, and not coming again), forgotten after a while.
	await db.delete(alarm).where(lte(alarm.doneAt, new Date(now.getTime() - KEEP_DONE_MS)));
	if (rows.length) {
		changed();
		void ringHouse();
	}
	await schedule();
}

let ringing = false;

/**
 * The house's ringing ones, said through Snapcast over the music: «din-don» and their names, with
 * a pause, until all are stopped or have rung for `RING_MAX_MS`.
 */
async function ringHouse() {
	if (ringing) return;
	if (!snapcastVoiceReady()) {
		log.warn('avisos', 'Sin Snapcast con voz: no puede sonar en la casa');
		return;
	}
	ringing = true;
	try {
		for (;;) {
			const now = Date.now();
			const sounding = (
				await db
					.select({ label: alarm.label, since: alarm.ringingSince })
					.from(alarm)
					.where(and(isNotNull(alarm.ringingSince), eq(alarm.place, 'casa')))
			).filter((r) => now - r.since!.getTime() < RING_MAX_MS);
			if (!sounding.length) break;
			const words = `Aviso: ${sounding.map((r) => r.label).join(' y ')}.`;
			await sayOnSnapcast(await houseSpeech(words, { chime: true }), 'house');
			await sleep(RING_PAUSE_MS);
		}
	} catch (error) {
		log.error('avisos', 'No se pudo sonar en la casa', { error });
	} finally {
		ringing = false;
	}
}

/** Whether `userId` sees it, to change it: the house's, or theirs. */
export async function canTouch(id: number, userId: string) {
	const people = await db.select().from(alarmPerson).where(eq(alarmPerson.alarmId, id));
	return !people.length || people.some((p) => p.userId === userId);
}
