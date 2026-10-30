import { and, asc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import {
	familyMember,
	familyPerson,
	kidGuardian,
	medication,
	medicationDose,
	user
} from '#lib/server/db/schema.ts';
import type { AnyDb } from '#lib/server/family-scope.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { notify } from '#lib/server/push.ts';
import { localDay, localTime } from 'comun/agenda.ts';
import {
	doseText,
	dosesOn,
	takenOn,
	type Dose,
	type Medication,
	type MedicationInput
} from 'comun/medication.ts';

/**
 * The family's medication (#308): each person's, seen by every grown-up of the family, and marked
 * by them. At each dose's time, a notice with «✓ Tomada» in it: a grown-up's to their phones; a
 * child's to its adults' (those who let it in, #303), or to every grown-up if it has none.
 */

/** A dose's notice, while the server was off: told still, if it is not later than this. */
const LATE_MINUTES = 180;

const hhmm = (time: string) => time.slice(0, 5);
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

function asMedication(r: typeof medication.$inferSelect): Medication {
	return {
		id: r.id,
		personId: String(r.personId),
		name: r.name,
		dose: r.dose,
		times: r.times.map(hhmm),
		days: r.days,
		startDay: r.startDay,
		endDay: r.endDay
	};
}

/** Everyone's, or one person's; by name. */
export function listMedication(k: Kitchen, personId: number | null = null) {
	return k.run(async (tx) => {
		const rows = await tx
			.select()
			.from(medication)
			.where(personId ? eq(medication.personId, personId) : undefined)
			.orderBy(asc(medication.name), asc(medication.id));
		return rows.map(asMedication);
	});
}

/** A day's doses of these, each with whether it was taken, when and by whom. */
export function dosesFor(k: Kitchen, meds: Medication[], day: string): Promise<Dose[]> {
	return k.run(async (tx) => {
		const ids = meds.map((m) => m.id);
		const marked = ids.length
			? await tx
					.select({
						medicationId: medicationDose.medicationId,
						time: medicationDose.time,
						takenAt: medicationDose.takenAt,
						by: user.name
					})
					.from(medicationDose)
					.leftJoin(user, eq(user.id, medicationDose.takenBy))
					.where(
						and(
							eq(medicationDose.day, day),
							inArray(medicationDose.medicationId, ids),
							isNotNull(medicationDose.takenAt)
						)
					)
			: [];
		return dosesOn(meds, day).map(({ medication: m, time }) => {
			const taken = marked.find((d) => d.medicationId === m.id && hhmm(d.time) === time);
			return {
				medicationId: m.id,
				personId: m.personId,
				name: m.name,
				dose: m.dose,
				day,
				time,
				takenAt: taken?.takenAt ? localTime(taken.takenAt) : null,
				takenBy: taken?.by ?? null
			};
		});
	});
}

function values(input: MedicationInput) {
	return {
		personId: Number(input.personId),
		name: input.name,
		dose: input.dose,
		times: input.times,
		days: input.days,
		startDay: input.startDay,
		endDay: input.endDay
	};
}

/** Its person, of the family: another's id is not found (row security). */
async function isPerson(tx: AnyDb, id: number) {
	if (!Number.isInteger(id)) return false;
	const [row] = await tx
		.select({ id: familyPerson.id })
		.from(familyPerson)
		.where(eq(familyPerson.id, id));
	return Boolean(row);
}

/** New (no `id`) or changed. Its id; null if its person or itself is not of the family. */
export function saveMedication(k: Kitchen, id: number | null, input: MedicationInput) {
	return k.run(async (tx) => {
		if (!(await isPerson(tx, Number(input.personId)))) return null;
		if (id) {
			const rows = await tx
				.update(medication)
				.set(values(input))
				.where(eq(medication.id, id))
				.returning({ id: medication.id });
			return rows[0]?.id ?? null;
		}
		const [row] = await tx
			.insert(medication)
			.values({ ...values(input), familyId: k.familyId, userId: k.userId })
			.returning({ id: medication.id });
		return row!.id;
	});
}

export async function deleteMedication(k: Kitchen, id: number) {
	await k.run((tx) => tx.delete(medication).where(eq(medication.id, id)));
}

/**
 * A dose of `day` at `time` marked as taken (or not, `taken` false), by the kitchen's person.
 * False if it is not one of its doses.
 */
export function markDose(k: Kitchen, id: number, day: string, time: string, taken: boolean) {
	return k.run(async (tx) => {
		const [row] = await tx.select().from(medication).where(eq(medication.id, id));
		if (!row) return false;
		const m = asMedication(row);
		if (!takenOn(m, day) || !m.times.includes(time)) return false;
		const set = { takenAt: taken ? new Date() : null, takenBy: taken ? k.userId : null };
		await tx
			.insert(medicationDose)
			.values({ familyId: k.familyId, medicationId: id, day, time, ...set })
			.onConflictDoUpdate({
				target: [medicationDose.medicationId, medicationDose.day, medicationDose.time],
				set
			});
		return true;
	});
}

/**
 * Whose phones a person's doses go to: a grown-up's, theirs; a child's (with an account of a
 * child, #303, or without one), its adults', or every grown-up's if it has none.
 */
export async function toldFor(k: Kitchen, personId: number) {
	const [person] = await k.run((tx) =>
		tx
			.select({ userId: familyPerson.userId, role: familyMember.role })
			.from(familyPerson)
			.leftJoin(familyMember, eq(familyMember.userId, familyPerson.userId))
			.where(eq(familyPerson.id, personId))
	);
	if (!person) return [];
	if (person.userId && person.role !== 'peque') return [person.userId];
	const guardians = person.userId
		? await k.run((tx) =>
				tx
					.select({ id: kidGuardian.guardianId })
					.from(kidGuardian)
					.where(eq(kidGuardian.kidId, person.userId!))
			)
		: [];
	if (guardians.length) return guardians.map((g) => g.id);
	const adults = await k.run((tx) =>
		tx.select({ id: familyMember.userId }).from(familyMember).where(ne(familyMember.role, 'peque'))
	);
	return adults.map((a) => a.id);
}

/**
 * For the home page: today's doses not taken yet that are told to this grown-up (theirs, and their
 * children's), by time.
 */
export async function pendingDosesOf(k: Kitchen, userId: string) {
	const meds = await listMedication(k);
	const mine = new Set<string>();
	for (const personId of new Set(meds.map((m) => m.personId)))
		if ((await toldFor(k, Number(personId))).includes(userId)) mine.add(personId);
	const doses = await dosesFor(
		k,
		meds.filter((m) => mine.has(m.personId)),
		localDay()
	);
	return doses.filter((d) => !d.takenAt);
}

/**
 * Every minute, for a family (scheduler.ts): the doses whose time has come, told once (each one's
 * row is made first: two servers, or one already marked, tell nothing). A person's at the same
 * time go in one notice, whose button marks them all. One due while
 * the server was off, if it is not much later.
 */
export async function sendDueDoses(k: Kitchen) {
	const now = new Date();
	const day = localDay(now);
	const at = minutes(localTime(now));
	const meds = await listMedication(k);
	const due = dosesOn(meds, day).filter(
		({ time }) => minutes(time) <= at && at - minutes(time) <= LATE_MINUTES
	);
	if (!due.length) return;
	// Each person's at the same time, together: one notice.
	const groups = new Map<string, { personId: string; time: string; meds: Medication[] }>();
	for (const { medication: m, time } of due) {
		const claimed = await k.run((tx) =>
			tx
				.insert(medicationDose)
				.values({ familyId: k.familyId, medicationId: m.id, day, time, notifiedAt: now })
				.onConflictDoNothing()
				.returning({ id: medicationDose.medicationId })
		);
		if (!claimed.length) continue;
		const key = `${m.personId}-${time}`;
		const group = groups.get(key) ?? { personId: m.personId, time, meds: [] };
		group.meds.push(m);
		groups.set(key, group);
	}
	if (!groups.size) return;
	const people = await names(k);
	for (const { personId, time, meds: these } of groups.values()) {
		const who = people.get(Number(personId)) ?? '';
		const query = new URLSearchParams({ dia: day, hora: time });
		for (const m of these) query.append('id', String(m.id));
		await notify(k.familyId, await toldFor(k, Number(personId)), {
			title: `💊 ${who ? `${who}, ` : ''}${time}`,
			body: these.map(doseText).join(' · '),
			tag: `toma-${personId}-${day}-${time}`,
			url: `/agenda/medicacion?persona=${personId}`,
			ttl: LATE_MINUTES * 60,
			sticky: true,
			actions: [
				{
					action: 'tomada',
					title: these.length > 1 ? '✓ Tomadas' : '✓ Tomada',
					post: `/api/medicacion/tomada?${query}`
				}
			]
		});
		console.info(`[medicación] Aviso de las ${time}: ${these.map((m) => m.name).join(', ')}`, {
			personId
		});
	}
}

/** Each person's name, by id. */
async function names(k: Kitchen) {
	const rows = await k.run((tx) =>
		tx
			.select({ id: familyPerson.id, name: familyPerson.name, account: user.name })
			.from(familyPerson)
			.leftJoin(user, eq(user.id, familyPerson.userId))
	);
	return new Map(rows.map((r) => [r.id, r.account ?? r.name]));
}
