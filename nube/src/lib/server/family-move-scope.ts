import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { orphansOf } from './account-deletion-scope.ts';
import {
	alarm,
	alarmPerson,
	calendarEvent,
	calendarEventPerson,
	car,
	carDriver,
	family,
	familyMember,
	familyPerson,
	heard,
	inbox,
	kidGuardian,
	medication,
	medicationDose,
	memory,
	note,
	oauthAccessToken,
	oauthClient,
	oauthConsent,
	oauthRefreshToken,
	paper,
	paperEvent,
	paperPerson,
	plannedLeg,
	plannedTrip,
	plannedTripPerson,
	podcast,
	podcastEpisode,
	podcastProgress,
	podcastSubscription,
	pushSubscription,
	rule,
	savedPlace,
	savedRoute,
	trip,
	tripPhoto,
	user,
	walk,
	walkPhoto
} from './db/schema.ts';
import type { AnyDb } from './family-scope.ts';
import { openFileFor, openFor, sealFileFor, sealFor } from './family-secret.ts';
import { PAPERS_AREA_NAME, PERSON_DATA } from './person-data.ts';
import * as realStorage from './storage.ts';

/**
 * Leaving a family (#315), unlinked or on one's own: a family of one, with what is theirs, as
 * person-data.ts says. On the app's own role, so that row-level security still holds: one
 * transaction that reads and deletes in the old family (`app.family_id`), then says the new one
 * and writes there. What is moved keeps its id, as some files are named by it; what is copied gets
 * a new one.
 *
 * Their files are copied first and the originals removed last: a failure on the way leaves the old
 * family as it was, and the new one, empty, is removed.
 */

/** Tables moved row by row: in the order they can be written, each after what it points at. */
export const MOVED_IN_ORDER = [
	'trip',
	'trip_photo',
	'saved_place',
	'saved_route',
	'walk',
	'walk_photo',
	'note',
	'rule',
	'memory',
	'heard',
	'inbox',
	'push_subscription',
	'medication',
	'medication_dose',
	'podcast_subscription',
	'podcast_progress'
] as const;

/** All the rest the move answers for: a table here or above, or person-data.test.ts fails. */
export const HANDLED_APART = [
	'calendar_event',
	'calendar_event_person',
	'alarm',
	'alarm_person',
	'paper',
	'paper_person',
	'paper_event',
	'planned_trip',
	'planned_trip_person',
	'planned_leg',
	'car',
	'car_driver',
	'podcast',
	'podcast_episode'
] as const;

type Row = Record<string, unknown>;
type Moved = (typeof MOVED_IN_ORDER)[number];

export type MoveResult =
	| {
			ok: true;
			familyId: string;
			familyName: string;
			oldFamilyName: string;
			email: string;
			name: string;
			oldFamilyId: string;
			orphanKids: string[];
			admins: string[];
	  }
	| { ok: false; problem: string };

export const setFamily = (tx: AnyDb, familyId: string) =>
	tx.execute(sql`select set_config('app.family_id', ${familyId}, true)`);

/** Of a person who stays behind: empty in the new family. Theirs, as it is. */
const onlyMine = (value: unknown, me: string) => (value === me ? value : null);

/** The ones for this person, and which of them are for no one else. */
async function byPeople(tx: AnyDb, table: PgTable, key: PgColumn, who: PgColumn, personId: number) {
	const rows = (await tx
		.select({ id: key, who })
		.from(table)
		.where(inArray(key, tx.select({ id: key }).from(table).where(eq(who, personId))))) as {
		id: number;
		who: number;
	}[];
	const people = new Map<number, number>();
	for (const row of rows) people.set(row.id, (people.get(row.id) ?? 0) + 1);
	const only: number[] = [];
	const shared: number[] = [];
	for (const [id, count] of people) (count === 1 ? only : shared).push(id);
	return { only, shared };
}

interface Picked {
	person: Row | undefined;
	moved: Map<Moved, Row[]>;
	events: { only: number[]; shared: number[] };
	alarms: { only: number[]; shared: number[] };
	papers: { only: number[]; shared: number[] };
	trips: { only: number[]; shared: number[] };
	cars: number[];
	podcasts: number[];
}

/** What of theirs there is, at this moment, in the family in `app.family_id`. */
async function pick(tx: AnyDb, userId: string): Promise<Picked> {
	const [person] = await tx.select().from(familyPerson).where(eq(familyPerson.userId, userId));
	const personId = person?.id ?? null;
	const moved = new Map<Moved, Row[]>();
	const mine = async (table: PgTable, column: PgColumn) =>
		(await tx.select().from(table).where(eq(column, userId))) as Row[];
	moved.set('trip', await mine(trip, trip.userId));
	moved.set('trip_photo', await mine(tripPhoto, tripPhoto.userId));
	moved.set('saved_place', await mine(savedPlace, savedPlace.userId));
	moved.set('saved_route', await mine(savedRoute, savedRoute.userId));
	moved.set('walk', await mine(walk, walk.userId));
	moved.set('walk_photo', await mine(walkPhoto, walkPhoto.userId));
	moved.set('note', await mine(note, note.userId));
	moved.set('rule', await mine(rule, rule.userId));
	moved.set('memory', await mine(memory, memory.userId));
	moved.set('heard', await mine(heard, heard.userId));
	moved.set('inbox', await mine(inbox, inbox.userId));
	moved.set('push_subscription', await mine(pushSubscription, pushSubscription.userId));
	moved.set('podcast_subscription', await mine(podcastSubscription, podcastSubscription.userId));
	moved.set('podcast_progress', await mine(podcastProgress, podcastProgress.userId));
	const medications =
		personId === null
			? []
			: ((await tx.select().from(medication).where(eq(medication.personId, personId))) as Row[]);
	moved.set('medication', medications);
	moved.set(
		'medication_dose',
		medications.length
			? ((await tx
					.select()
					.from(medicationDose)
					.where(
						inArray(
							medicationDose.medicationId,
							medications.map((m) => m.id as number)
						)
					)) as Row[])
			: []
	);

	const none = { only: [], shared: [] };
	const events =
		personId === null
			? none
			: await byPeople(
					tx,
					calendarEventPerson,
					calendarEventPerson.eventId,
					calendarEventPerson.personId,
					personId
				);
	const alarms =
		personId === null
			? none
			: await byPeople(tx, alarmPerson, alarmPerson.alarmId, alarmPerson.personId, personId);
	const papers =
		personId === null
			? none
			: await byPeople(tx, paperPerson, paperPerson.paperId, paperPerson.personId, personId);
	const going =
		personId === null
			? none
			: await byPeople(
					tx,
					plannedTripPerson,
					plannedTripPerson.tripId,
					plannedTripPerson.personId,
					personId
				);
	// Private: only its maker's, whoever is on it: theirs go, another's are not theirs to see.
	const privates = await tx
		.select({ id: plannedTrip.id, userId: plannedTrip.userId })
		.from(plannedTrip)
		.where(eq(plannedTrip.private, true));
	const isHidden = new Set(privates.filter((t) => t.userId !== userId).map((t) => t.id));
	const trips = {
		only: [
			...new Set([
				...going.only.filter((id) => !isHidden.has(id)),
				...privates.filter((t) => t.userId === userId).map((t) => t.id)
			])
		],
		shared: going.shared.filter(
			(id) => !isHidden.has(id) && !privates.some((t) => t.id === id && t.userId === userId)
		)
	};

	const [driving] = await tx.select().from(carDriver).where(eq(carDriver.userId, userId));
	let cars: number[] = [];
	if (driving) {
		const drivers = await tx.select().from(carDriver).where(eq(carDriver.carId, driving.carId));
		if (drivers.length === 1) cars = [driving.carId];
	}
	const podcasts = (moved.get('podcast_subscription') ?? []).map((s) => s.podcastId as number);
	return { person, moved, events, alarms, papers, trips, cars, podcasts };
}

/** Each file that goes, by the list: where it is and what it is called. */
function filesOf(picked: Picked) {
	const files: { area: string; name: string }[] = [];
	for (const table of MOVED_IN_ORDER) {
		const stored = PERSON_DATA[table].zip && PERSON_DATA[table].zip.stored;
		if (!stored) continue;
		for (const row of picked.moved.get(table) ?? []) {
			const value = row[stored.column];
			if (value === null || value === undefined) continue;
			files.push({
				area: stored.area,
				name: `${String(value).split('/').pop()}${stored.suffix ?? ''}`
			});
		}
	}
	return files;
}

interface SealedPaper {
	name: string;
	notes: string | null;
}

/** Of the families' files, what moving them takes. */
export type MoveFiles = Pick<
	typeof realStorage,
	'copyFile' | 'putFile' | 'readFile' | 'removeAllFiles' | 'removeFile'
>;

export function familyMoveScope(
	db: AnyDb,
	{ role, storage = realStorage }: { role?: string; storage?: MoveFiles } = {}
) {
	/** A transaction as the app's role, knowing who asks; each family said when it is its turn. */
	const inTx = <T>(userId: string, fn: (tx: AnyDb) => Promise<T>) =>
		db.transaction(async (tx) => {
			if (role) await tx.execute(sql`select set_config('role', ${role}, true)`);
			await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
			return fn(tx as unknown as AnyDb);
		});

	/** Whether this may be done, and what family they are leaving. */
	async function allowed(
		by: string,
		userId: string
	): Promise<{ familyId: string } | { problem: string }> {
		return inTx(by, async (tx) => {
			const [asker] = await tx
				.select({ familyId: familyMember.familyId, role: familyMember.role })
				.from(familyMember)
				.where(eq(familyMember.userId, by));
			if (!asker) return { problem: 'No estás en ninguna familia' };
			await setFamily(tx, asker.familyId);
			const members = await tx
				.select({ userId: familyMember.userId, role: familyMember.role })
				.from(familyMember);
			const them = members.find((m) => m.userId === userId);
			if (!them) return { problem: 'No es de tu familia' };
			if (them.role === 'peque') return { problem: 'Las cuentas de peque no se desvinculan' };
			const others = members.filter((m) => m.userId !== userId && m.role !== 'peque');
			if (by === userId) {
				if (!others.length) return { problem: 'Eres el único adulto de la familia' };
				if (them.role === 'admin' && !others.some((m) => m.role === 'admin'))
					return { problem: 'Antes, pasa la administración a otro adulto' };
			} else {
				if (asker.role !== 'admin') return { problem: 'Solo quien administra la familia' };
				if (them.role !== 'member')
					return { problem: 'No se puede desvincular a quien administra' };
			}
			return { familyId: asker.familyId };
		});
	}

	/** Leaves `userId`, by `by`: themselves, or who administers their family. */
	async function leave(by: string, userId: string): Promise<MoveResult> {
		const check = await allowed(by, userId);
		if ('problem' in check) return { ok: false, problem: check.problem };
		const oldFamilyId = check.familyId;
		const newFamilyId = randomUUID();

		const [account] = await inTx(userId, (tx) =>
			tx.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, userId))
		);
		const familyName = `Familia de ${account.name}`.slice(0, 60);
		// Before anything: a family has to be there for its data key, and its files to be kept.
		await inTx(userId, async (tx) => {
			await setFamily(tx, newFamilyId);
			await tx.insert(family).values({ id: newFamilyId, name: familyName });
		});

		try {
			const picked = await inTx(userId, async (tx) => {
				await setFamily(tx, oldFamilyId);
				return pick(tx, userId);
			});

			// The files first, each to its new family; the sealed ones, opened and sealed again.
			const copied = new Set<string>();
			for (const f of filesOf(picked)) {
				await storage.copyFile(oldFamilyId, newFamilyId, f.area, f.name);
				copied.add(`${f.area}/${f.name}`);
			}
			const originals = filesOf(picked);
			const papers = await inTx(userId, async (tx) => {
				await setFamily(tx, oldFamilyId);
				const ids = [...picked.papers.only, ...picked.papers.shared];
				return ids.length ? tx.select().from(paper).where(inArray(paper.id, ids)) : [];
			});
			const sealedPapers = new Map<number, SealedPaper>();
			for (const p of papers) {
				// One that cannot be opened stops it all: better than losing it.
				const sealAgain = async (value: string) => {
					const open = await openFor(oldFamilyId, value);
					if (open === null) throw new Error('No se pudo abrir un papel');
					return sealFor(newFamilyId, open);
				};
				sealedPapers.set(p.id, {
					name: await sealAgain(p.name),
					notes: p.notes ? await sealAgain(p.notes) : null
				});
				const bytes = await storage.readFile(oldFamilyId, PAPERS_AREA_NAME, p.file);
				if (bytes) {
					const open = await openFileFor(oldFamilyId, bytes);
					if (!open) throw new Error('No se pudo abrir el fichero de un papel');
					await storage.putFile(
						newFamilyId,
						PAPERS_AREA_NAME,
						p.file,
						await sealFileFor(newFamilyId, open),
						'application/octet-stream'
					);
				} else console.warn('[familias] Falta el fichero de un papel', p.id);
				if (picked.papers.only.includes(p.id))
					originals.push({ area: PAPERS_AREA_NAME, name: p.file });
			}

			const done = await inTx(userId, (tx) =>
				move(tx, { by, userId, oldFamilyId, newFamilyId, name: account.name, sealedPapers })
			);
			if ('problem' in done) throw new Stopped(done.problem);

			// Something added in between: the row went, and so must its file.
			for (const f of done.files)
				if (!copied.has(`${f.area}/${f.name}`)) {
					await storage
						.copyFile(oldFamilyId, newFamilyId, f.area, f.name)
						.catch((error) =>
							console.warn('[familias] No se pudo copiar un fichero', String(error))
						);
					originals.push(f);
				}
			for (const { area, name } of originals)
				await storage
					.removeFile(oldFamilyId, area, name)
					.catch((error) => console.warn('[familias] No se pudo borrar un fichero', String(error)));
			return {
				ok: true,
				familyId: newFamilyId,
				familyName,
				oldFamilyName: done.oldFamilyName,
				oldFamilyId,
				email: account.email,
				name: account.name,
				orphanKids: done.orphanKids,
				admins: done.admins
			};
		} catch (error) {
			await inTx(userId, async (tx) => {
				await setFamily(tx, newFamilyId);
				await tx.delete(family).where(eq(family.id, newFamilyId));
			}).catch((err) => console.error('[familias] No se pudo quitar la familia nueva', err));
			await storage
				.removeAllFiles(newFamilyId)
				.catch((err) =>
					console.warn('[familias] No se pudieron quitar los ficheros nuevos', String(err))
				);
			if (error instanceof Stopped) return { ok: false, problem: error.message };
			throw error;
		}
	}

	return { leave };
}

export class Stopped extends Error {}

/** The move itself: all of it, or nothing. */
async function move(
	tx: AnyDb,
	m: {
		by: string;
		userId: string;
		oldFamilyId: string;
		newFamilyId: string;
		name: string;
		sealedPapers: Map<number, SealedPaper>;
	}
) {
	const { userId, oldFamilyId, newFamilyId } = m;
	await setFamily(tx, oldFamilyId);

	// Locked and looked at again: two at once go one after the other, and the second finds this.
	const [member] = await tx
		.select()
		.from(familyMember)
		.where(eq(familyMember.userId, userId))
		.for('update');
	if (!member || member.familyId !== oldFamilyId)
		return { problem: 'Ya no está en esta familia' } as const;
	if (member.role === 'peque')
		return { problem: 'Las cuentas de peque no se desvinculan' } as const;
	if (m.by !== userId && member.role !== 'member')
		return { problem: 'No se puede desvincular a quien administra' } as const;

	const picked = await pick(tx, userId);
	const [old] = await tx.select({ name: family.name }).from(family);
	const { orphanKids, admins } = await orphansOf(tx, userId);
	const of = (table: Moved) => picked.moved.get(table) ?? [];

	const select = async (table: PgTable, column: PgColumn, ids: number[]) =>
		ids.length ? ((await tx.select().from(table).where(inArray(column, ids))) as Row[]) : [];

	const eventIds = [...picked.events.only, ...picked.events.shared];
	const alarmIds = [...picked.alarms.only, ...picked.alarms.shared];
	const paperIds = [...picked.papers.only, ...picked.papers.shared].filter((id) =>
		m.sealedPapers.has(id)
	);
	const tripIds = [...picked.trips.only, ...picked.trips.shared];
	const events = await select(calendarEvent, calendarEvent.id, eventIds);
	const alarms = await select(alarm, alarm.id, alarmIds);
	const papers = await select(paper, paper.id, paperIds);
	const paperLinks = await select(paperEvent, paperEvent.paperId, paperIds);
	const trips = await select(plannedTrip, plannedTrip.id, tripIds);
	const legs = await select(plannedLeg, plannedLeg.tripId, tripIds);
	const cars = await select(car, car.id, picked.cars);
	const onTrips = picked.person
		? await tx
				.select({ tripId: plannedTripPerson.tripId })
				.from(plannedTripPerson)
				.where(eq(plannedTripPerson.personId, picked.person.id as number))
		: [];
	const podcasts = await select(podcast, podcast.id, picked.podcasts);
	const episodes = await select(podcastEpisode, podcastEpisode.podcastId, picked.podcasts);

	// ——— Out of the old family: what points at something first.
	const gone = async (table: PgTable, column: PgColumn, ids: number[]) => {
		if (ids.length) await tx.delete(table).where(inArray(column, ids));
	};
	await tx.delete(kidGuardian).where(eq(kidGuardian.guardianId, userId));
	await tx.delete(podcastProgress).where(eq(podcastProgress.userId, userId));
	await tx.delete(podcastSubscription).where(eq(podcastSubscription.userId, userId));
	await tx.delete(carDriver).where(eq(carDriver.userId, userId));
	await gone(
		medication,
		medication.id,
		of('medication').map((r) => r.id as number)
	);
	await tx.delete(pushSubscription).where(eq(pushSubscription.userId, userId));
	await tx.delete(inbox).where(eq(inbox.userId, userId));
	await tx.delete(heard).where(eq(heard.userId, userId));
	await tx.delete(memory).where(eq(memory.userId, userId));
	await tx.delete(rule).where(eq(rule.userId, userId));
	await tx.delete(note).where(eq(note.userId, userId));
	await tx.delete(walkPhoto).where(eq(walkPhoto.userId, userId));
	await tx.delete(walk).where(eq(walk.userId, userId));
	await tx.delete(savedRoute).where(eq(savedRoute.userId, userId));
	await tx.delete(savedPlace).where(eq(savedPlace.userId, userId));
	await tx.delete(tripPhoto).where(eq(tripPhoto.userId, userId));
	await tx.delete(trip).where(eq(trip.userId, userId));
	await gone(car, car.id, picked.cars);
	await gone(plannedTrip, plannedTrip.id, picked.trips.only);
	await gone(
		paper,
		paper.id,
		picked.papers.only.filter((id) => m.sealedPapers.has(id))
	);
	await gone(alarm, alarm.id, picked.alarms.only);
	await gone(calendarEvent, calendarEvent.id, picked.events.only);

	// Their person stays while something shared says their name; with nothing, it goes.
	const person = picked.person;
	if (person) {
		const id = person.id as number;
		const still =
			picked.events.shared.length ||
			picked.alarms.shared.length ||
			picked.papers.shared.length ||
			picked.trips.shared.length;
		if (still)
			await tx
				.update(familyPerson)
				.set({ userId: null, name: m.name })
				.where(eq(familyPerson.id, id));
		else await tx.delete(familyPerson).where(eq(familyPerson.id, id));
	}
	await tx.delete(familyMember).where(eq(familyMember.userId, userId));

	// The old family's house's ways in: it is no longer theirs. The apps' stay.
	const houseClients = tx
		.select({ clientId: oauthClient.clientId })
		.from(oauthClient)
		.where(eq(oauthClient.referenceId, oldFamilyId));
	await tx
		.delete(oauthAccessToken)
		.where(
			and(eq(oauthAccessToken.userId, userId), inArray(oauthAccessToken.clientId, houseClients))
		);
	await tx
		.delete(oauthRefreshToken)
		.where(
			and(eq(oauthRefreshToken.userId, userId), inArray(oauthRefreshToken.clientId, houseClients))
		);
	await tx
		.delete(oauthConsent)
		.where(and(eq(oauthConsent.userId, userId), inArray(oauthConsent.clientId, houseClients)));

	// ——— Into the new one.
	await setFamily(tx, newFamilyId);
	const familyId = newFamilyId;
	await tx.insert(familyMember).values({ ...member, familyId, role: 'admin' });
	const [newPerson] = await tx
		.insert(familyPerson)
		.values({
			familyId,
			userId,
			name: m.name,
			avatar: (person?.avatar as string | null | undefined) ?? null
		})
		.returning({ id: familyPerson.id });
	const personId = newPerson.id;

	const carsGone = new Set(picked.cars);
	for (const row of cars)
		await tx
			.insert(car)
			.values({ ...row, familyId, parkedBy: onlyMine(row.parkedBy, userId) } as never);
	if (picked.cars.length)
		await tx.insert(carDriver).values({ familyId, userId, carId: picked.cars[0] });

	/** Each row in its new family, some of its columns changed. */
	const write = async (table: PgTable, rows: Row[], change: (row: Row) => Row = () => ({})) => {
		for (const row of rows)
			await tx.insert(table).values({ ...row, familyId, ...change(row) } as never);
	};
	const ruleIds = new Set(of('rule').map((r) => r.id as number));
	await write(trip, of('trip'), (r) => ({
		carId: carsGone.has(r.carId as number) ? r.carId : null
	}));
	await write(tripPhoto, of('trip_photo'));
	await write(savedPlace, of('saved_place'));
	await write(savedRoute, of('saved_route'));
	await write(walk, of('walk'));
	await write(walkPhoto, of('walk_photo'));
	await write(note, of('note'));
	await write(rule, of('rule'));
	await write(memory, of('memory'), (r) => ({
		ruleId: ruleIds.has(r.ruleId as number) ? r.ruleId : null
	}));
	await write(heard, of('heard'));
	await write(inbox, of('inbox'), (r) => ({ fromUserId: onlyMine(r.fromUserId, userId) }));
	await write(pushSubscription, of('push_subscription'));
	await write(medication, of('medication'), (r) => ({
		personId,
		userId: onlyMine(r.userId, userId)
	}));
	await write(medicationDose, of('medication_dose'), (r) => ({
		takenBy: onlyMine(r.takenBy, userId)
	}));

	/**
	 * What is only theirs, with its id; what is shared, a copy with a new one. Whichever it is, the
	 * new id is what is returned for what points at it.
	 */
	async function moveOrCopy(
		table: PgTable & { id: PgColumn },
		rows: Row[],
		only: number[],
		change: (row: Row) => Row = () => ({})
	) {
		const ids = new Map<number, number>();
		for (const row of rows) {
			const oldId = row.id as number;
			const values = { ...row, familyId, ...change(row) } as Row;
			if (!only.includes(oldId)) delete values.id;
			const [made] = (await tx
				.insert(table)
				.values(values as never)
				.returning({ id: table.id })) as { id: number }[];
			ids.set(oldId, made.id);
		}
		return ids;
	}
	const authored = (r: Row) => ({ userId: onlyMine(r.userId, userId) });

	const eventMap = await moveOrCopy(calendarEvent, events, picked.events.only, authored);
	if (eventMap.size)
		await tx
			.insert(calendarEventPerson)
			.values([...eventMap.values()].map((eventId) => ({ familyId, eventId, personId })));

	// A family of one has no satellites to ring on: to their phone.
	const alarmMap = await moveOrCopy(alarm, alarms, picked.alarms.only, (r) => ({
		...authored(r),
		place: 'movil',
		ringingSince: null
	}));
	if (alarmMap.size)
		await tx
			.insert(alarmPerson)
			.values([...alarmMap.values()].map((alarmId) => ({ familyId, alarmId, personId })));

	const tripMap = await moveOrCopy(plannedTrip, trips, picked.trips.only, authored);
	// Only those they go on: a private one of theirs may have no one.
	const going = onTrips.flatMap((r) => tripMap.get(r.tripId) ?? []);
	if (going.length)
		await tx
			.insert(plannedTripPerson)
			.values(going.map((tripId) => ({ familyId, tripId, personId })));
	const legOnly = new Set(picked.trips.only);
	for (const leg of legs) {
		const values = {
			...leg,
			familyId,
			tripId: tripMap.get(leg.tripId as number),
			eventId: eventMap.get(leg.eventId as number) ?? null
		} as Row;
		if (!legOnly.has(leg.tripId as number)) delete values.id;
		await tx.insert(plannedLeg).values(values as never);
	}

	const paperMap = await moveOrCopy(paper, papers, picked.papers.only, (r) => ({
		...authored(r),
		name: m.sealedPapers.get(r.id as number)!.name,
		notes: m.sealedPapers.get(r.id as number)!.notes
	}));
	if (paperMap.size)
		await tx
			.insert(paperPerson)
			.values([...paperMap.values()].map((paperId) => ({ familyId, paperId, personId })));
	for (const link of paperLinks) {
		const eventId = eventMap.get(link.eventId as number);
		const paperId = paperMap.get(link.paperId as number);
		if (eventId && paperId) await tx.insert(paperEvent).values({ familyId, paperId, eventId });
	}

	// The podcasts they follow: a copy of each, its episodes too, for where they were.
	const podcastMap = await moveOrCopy(podcast, podcasts, []);
	const episodeMap = await moveOrCopy(podcastEpisode, episodes, [], (r) => ({
		podcastId: podcastMap.get(r.podcastId as number)
	}));
	await write(podcastSubscription, of('podcast_subscription'), (r) => ({
		podcastId: podcastMap.get(r.podcastId as number)
	}));
	await write(
		podcastProgress,
		of('podcast_progress').filter((r) => episodeMap.has(r.episodeId as number)),
		(r) => ({ episodeId: episodeMap.get(r.episodeId as number) })
	);

	return {
		oldFamilyName: old?.name ?? '',
		orphanKids,
		admins,
		files: filesOf(picked)
	};
}
