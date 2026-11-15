import { and, asc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { addDays, localDay } from 'comun/agenda.ts';
import { euros, lineKey } from 'comun/expenses.ts';
import type { LngLat } from 'comun/road.ts';
import { metresBetween } from 'comun/road-guide.ts';
import { agendaByVoice } from '#lib/server/agenda/voice.ts';
import {
	calendarEvent,
	savedPlace,
	trip,
	tripPhoto,
	walk,
	walkPhoto
} from '#lib/server/db/schema.ts';
import { searchExpenses } from '#lib/server/expenses/expenses.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { describeNotes } from '#lib/server/notes.ts';
import { listPlannedTrips } from '#lib/server/trips/planned.ts';

/**
 * Periods and places (#505, phase 1): the trips of whoever asks, found by their place or their days
 * (driven in the road mode, planned in Viajes, written down in the Agenda), to confirm before a
 * report; and everything of the sections between two days. What each person sees: their own trips,
 * walks, photos and notes; the family's agenda, money and planned trips (theirs private too).
 */

/** A stay ends with the first drive that ends farther than this from where it arrived. */
export const AWAY_METRES = 30_000;
/** Without words, only drives this long are trips somewhere. */
export const LONG_DRIVE_METRES = 50_000;
/** A place kept with its name counts as a drive's end this near. */
const PLACE_METRES = 2_000;
/** A stay with no drive back within this long is told without its end. */
const STAY_DAYS = 30;
/** Trips told at once, the latest. */
const TRIPS_TOLD = 12;
/** Looked back for trips without days: two years. */
const LOOKED_BACK_DAYS = 730;
/** Days read at once. */
export const PERIOD_DAYS = 31;
/** Expenses listed one by one; the rest only in the sums. */
const EXPENSES_LISTED = 30;

const isDay = (v: unknown): v is string =>
	typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const words = (v: unknown) => (typeof v === 'string' ? lineKey(v) : '');
const km = (metres: number) => `${Math.round(metres / 1000)} km`;
/** Its days, both included. */
const daysBetween = (from: string, to: string) =>
	Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

export interface Drive {
	startedAt: Date;
	endedAt: Date;
	distance: number;
	destination: string | null;
	/** Its last position. */
	end: LngLat | null;
}

export interface Stay {
	from: string;
	/** The day it drove back; null, not driven back (yet, or not kept). */
	to: string | null;
	place: string;
	/** The drive there, the ones around and the one back. */
	metres: number;
	drives: number;
	there: { day: string; metres: number };
	back: { day: string; metres: number } | null;
}

/**
 * The stays somewhere, from the drives in order: a drive that `arrives` somewhere, the ones that end
 * near it (around the place), and the first that ends far from it (back). A drive inside a stay
 * starts no other.
 */
export function staysOf(drives: Drive[], arrives: (d: Drive) => string | null): Stay[] {
	const stays: Stay[] = [];
	for (let i = 0; i < drives.length; i++) {
		const there = drives[i]!;
		const place = arrives(there);
		if (!place || !there.end) continue;
		const stay: Stay = {
			from: localDay(there.startedAt),
			to: null,
			place,
			metres: there.distance,
			drives: 1,
			there: { day: localDay(there.startedAt), metres: there.distance },
			back: null
		};
		const until = there.endedAt.getTime() + STAY_DAYS * 86_400_000;
		let j = i + 1;
		for (; j < drives.length && drives[j]!.startedAt.getTime() <= until; j++) {
			const next = drives[j]!;
			stay.metres += next.distance;
			stay.drives++;
			if (next.end && metresBetween(next.end, there.end) > AWAY_METRES) {
				stay.to = localDay(next.startedAt);
				stay.back = { day: stay.to, metres: next.distance };
				break;
			}
		}
		stays.push(stay);
		// On from the drive back, or from the first one after the stay.
		i = stay.back ? j : j - 1;
	}
	return stays;
}

/** A trip found: its days, its place, and what says it (driven, planned, in the agenda). */
export interface FoundTrip {
	from: string;
	to: string | null;
	places: string[];
	said: string[];
}

/** Those whose days touch, one: the drive and the planned trip of the same holidays. */
export function mergeTrips(found: FoundTrip[]): FoundTrip[] {
	const sorted = found.toSorted((a, b) => a.from.localeCompare(b.from));
	const merged: FoundTrip[] = [];
	for (const f of sorted) {
		const last = merged.at(-1);
		const lastEnd = last ? (last.to ?? last.from) : null;
		if (last && lastEnd && f.from <= addDays(lastEnd, 1)) {
			if (f.to && (!last.to || f.to > last.to)) last.to = f.to;
			for (const p of f.places) if (!last.places.includes(p)) last.places.push(p);
			last.said.push(...f.said);
		} else merged.push({ ...f, places: [...f.places], said: [...f.said] });
	}
	return merged;
}

const dayText = (day: string) => {
	const [y, m, d] = day.split('-');
	return `${Number(d)}/${Number(m)}/${y}`;
};

/** The stay, as the AI is told it. */
function stayText(s: Stay) {
	const back = s.back
		? `, vuelta el ${dayText(s.back.day)} (${km(s.back.metres)})`
		: ', sin vuelta grabada';
	return `grabado en el modo carretera: ida el ${dayText(s.there.day)} (${km(s.there.metres)})${back}, ${km(s.metres)} en ${s.drives} trayectos`;
}

/** The drives of `userId` from `since`, in order, each with its last position. */
async function drivesOf(k: Kitchen, userId: string, since: Date, until: Date): Promise<Drive[]> {
	const rows = await k.run((tx) =>
		tx
			.select({
				startedAt: trip.startedAt,
				endedAt: trip.endedAt,
				distance: trip.distance,
				destination: trip.destination,
				last: sql<[number, number, number] | null>`${trip.line} -> -1`
			})
			.from(trip)
			.where(and(eq(trip.userId, userId), gte(trip.startedAt, since), lte(trip.startedAt, until)))
			.orderBy(asc(trip.startedAt))
	);
	return rows.map((r) => ({
		startedAt: r.startedAt,
		endedAt: r.endedAt,
		distance: r.distance,
		destination: r.destination,
		end: r.last ? [r.last[0], r.last[1]] : null
	}));
}

/**
 * «Mis dos últimos viajes a Alicante»: the trips of whoever asks to a place (`words`, its name, or
 * none: any long drive and any planned trip), between two days (none: the last two years). Said
 * for the AI, the latest last, to confirm with the person before using them.
 */
export async function findTrips(
	k: Kitchen,
	userId: string,
	args: Record<string, unknown>,
	now = new Date()
): Promise<string> {
	const asked = words(args.place);
	const to = isDay(args.to_day) ? args.to_day : localDay(now);
	const from = isDay(args.from_day) ? args.from_day : addDays(to, -LOOKED_BACK_DAYS);
	if (from > to) return 'El primer día va antes que el último.';
	const matches = (text: string | null | undefined) =>
		Boolean(text && asked && lineKey(text).includes(asked));

	// From a day before, so the drive there of a stay that starts on `from` is in; to a month after,
	// for its drive back.
	const since = new Date(`${addDays(from, -1)}T00:00:00`);
	const until = new Date(`${addDays(to, STAY_DAYS)}T23:59:59`);
	const [drives, places, planned, events] = await Promise.all([
		drivesOf(k, userId, since, until),
		k.run((tx) =>
			tx
				.select({
					name: savedPlace.name,
					address: savedPlace.address,
					lon: savedPlace.lon,
					lat: savedPlace.lat
				})
				.from(savedPlace)
				.where(eq(savedPlace.userId, userId))
		),
		listPlannedTrips(k),
		asked
			? k.run((tx) =>
					tx
						.select({
							title: calendarEvent.title,
							notes: calendarEvent.notes,
							startDay: calendarEvent.startDay,
							endDay: calendarEvent.endDay
						})
						.from(calendarEvent)
						.where(
							and(
								isNull(calendarEvent.repeat),
								lte(calendarEvent.startDay, to),
								gte(sql`coalesce(${calendarEvent.endDay}, ${calendarEvent.startDay})`, from)
							)
						)
				)
			: Promise.resolve([])
	]);

	// The place a drive arrives at: its route's destination, or a place kept near its end.
	const named = places.filter((p) => !asked || matches(p.name) || matches(p.address));
	const arrives = (d: Drive) => {
		if (asked && matches(d.destination)) return d.destination;
		const near = d.end && named.find((p) => metresBetween([p.lon, p.lat], d.end!) <= PLACE_METRES);
		if (asked) return near ? near.name : null;
		if (d.distance < LONG_DRIVE_METRES) return null;
		return d.destination ?? near?.name ?? 'sin destino guardado';
	};
	const found: FoundTrip[] = staysOf(drives, arrives)
		.filter((s) => s.from >= from && s.from <= to)
		.map((s) => ({ from: s.from, to: s.to, places: [s.place], said: [stayText(s)] }));

	for (const t of planned) {
		if (!t.legs.length) continue;
		if (asked && !matches(t.name) && !t.legs.some((l) => matches(l.from) || matches(l.to)))
			continue;
		const first = t.legs[0]!.day;
		const last = t.legs.at(-1)!.day;
		if (last < from || first > to) continue;
		const legs = t.legs.map((l) => `${dayText(l.day)} ${l.from} → ${l.to}`).join('; ');
		found.push({
			from: first,
			to: last,
			places: [t.legs[0]!.to],
			said: [`planeado en Viajes, «${t.name}»: ${legs}`]
		});
	}

	for (const e of events) {
		if (!matches(e.title) && !matches(e.notes)) continue;
		found.push({
			from: e.startDay,
			to: e.endDay ?? e.startDay,
			places: [],
			said: [`en la agenda: «${e.title}»`]
		});
	}

	const trips = mergeTrips(found).slice(-TRIPS_TOLD);
	if (!trips.length)
		return asked
			? `No hay ningún viaje a «${String(args.place).trim()}» entre ${from} y ${to}: ni grabado en el modo carretera, ni planeado en Viajes, ni en la agenda. Los trayectos solo se graban si la persona lo activó en Ajustes.`
			: `No hay viajes entre ${from} y ${to}.`;
	const lines = trips.map((t) => {
		const days = t.to && t.to !== t.from ? `${t.from} a ${t.to}` : t.from;
		const where = t.places.length ? ` ${t.places.join(' / ')}:` : '';
		return `- ${days}:${where} ${t.said.join('; ')}.`;
	});
	return [
		`Viajes encontrados (del más antiguo al más reciente):`,
		...lines,
		'Antes de usarlos, pregunta si son estos, con sus fechas en palabras. Después, read_period con sus días.'
	].join('\n');
}

/** Rows of a person's, from `from` to `to` (local days), by their own time. */
const within = (from: string, to: string) => ({
	since: new Date(`${from}T00:00:00`),
	until: new Date(`${to}T23:59:59.999`)
});

/**
 * Everything between two days, for whoever asks: their drives, walks and photos, the family's
 * expenses (by category, and one by one) and agenda, their notes. Said for the AI.
 */
export async function readPeriod(
	k: Kitchen,
	userId: string,
	args: Record<string, unknown>
): Promise<string> {
	if (!isDay(args.from_day) || !isDay(args.to_day)) return 'Faltan los días, AAAA-MM-DD.';
	const [from, to] =
		args.from_day <= args.to_day ? [args.from_day, args.to_day] : [args.to_day, args.from_day];
	if (daysBetween(from, to) > PERIOD_DAYS) return `Como mucho ${PERIOD_DAYS} días de una vez.`;
	const { since, until } = within(from, to);

	const [drives, walks, photos, walkPhotos, expenses, agenda, notes] = await Promise.all([
		drivesOf(k, userId, since, until),
		k.run((tx) =>
			tx
				.select({ startedAt: walk.startedAt, endedAt: walk.endedAt, distance: walk.distance })
				.from(walk)
				.where(and(eq(walk.userId, userId), gte(walk.startedAt, since), lte(walk.startedAt, until)))
				.orderBy(asc(walk.startedAt))
		),
		k.run((tx) =>
			tx
				.select({ at: tripPhoto.takenAt })
				.from(tripPhoto)
				.where(
					and(
						eq(tripPhoto.userId, userId),
						gte(tripPhoto.takenAt, since),
						lte(tripPhoto.takenAt, until)
					)
				)
		),
		k.run((tx) =>
			tx
				.select({ at: walkPhoto.at })
				.from(walkPhoto)
				.where(
					and(eq(walkPhoto.userId, userId), gte(walkPhoto.at, since), lte(walkPhoto.at, until))
				)
		),
		searchExpenses(k, { text: '', from, to }, { limit: null }),
		agendaByVoice(k, { from, to }, null),
		describeNotes(k, userId, { words: null, fromDay: from, untilDay: to })
	]);

	const out = [`Del ${from} al ${to}:`];

	out.push(
		drives.length
			? `En coche (grabado): ${drives.length} trayectos, ${km(drives.reduce((s, d) => s + d.distance, 0))}. ${drives
					.map(
						(d) =>
							`${localDay(d.startedAt)} ${km(d.distance)}${d.destination ? ` a ${d.destination}` : ''}`
					)
					.join('; ')}.`
			: 'En coche: nada grabado.'
	);
	out.push(
		walks.length
			? `Paseos: ${walks.length}, ${km(walks.reduce((s, w) => s + w.distance, 0))}. ${walks
					.map((w) => `${localDay(w.startedAt)} ${km(w.distance)}`)
					.join('; ')}.`
			: 'Paseos: ninguno.'
	);
	const photoDays = Map.groupBy(
		[...photos, ...walkPhotos].map((p) => localDay(p.at)),
		(d) => d
	);
	out.push(
		photoDays.size
			? `Fotos (del modo carretera y de los paseos): ${photos.length + walkPhotos.length}. ${[
					...photoDays
				]
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([day, list]) => `${day} ${list.length}`)
					.join('; ')}.`
			: 'Fotos: ninguna.'
	);

	const spent = expenses.filter((e) => !e.fixed);
	const fixed = expenses.filter((e) => e.fixed);
	if (spent.length) {
		const byCategory = Map.groupBy(spent, (e) => e.category);
		const sums = [...byCategory]
			.map(([c, list]) => [c, list.reduce((s, e) => s + e.total, 0)] as const)
			.sort((a, b) => b[1] - a[1]);
		const listed = spent
			.toSorted((a, b) => a.date.localeCompare(b.date))
			.slice(0, EXPENSES_LISTED)
			.map((e) => {
				const lines = e.lines
					.slice(0, 4)
					.map((l) => l.text)
					.join(', ');
				return `  ${e.date}: ${e.store}, ${euros(e.total)} (${e.category})${lines ? `: ${lines}` : ''}`;
			});
		out.push(
			`Gastos de la familia esos días: ${spent.length}, ${euros(spent.reduce((s, e) => s + e.total, 0))} (${sums
				.map(([c, t]) => `${c} ${euros(t)}`)
				.join(
					', '
				)}). Los gastos no guardan dónde se hicieron: son todos los de esos días, también compras por internet o de quien se quedó en casa; dilo al hablar de ellos.`,
			...listed,
			...(spent.length > EXPENSES_LISTED
				? [`  … y ${spent.length - EXPENSES_LISTED} más (en las sumas de arriba).`]
				: [])
		);
	} else out.push('Gastos: ninguno apuntado.');
	if (fixed.length)
		out.push(
			`Fijos que cayeron esos días (no son del viaje): ${fixed.map((e) => `${e.store} ${euros(e.total)}`).join(', ')}.`
		);

	out.push(`Agenda:\n${agenda}`);
	out.push(`Notas de esta persona:\n${notes}`);
	return out.join('\n');
}
