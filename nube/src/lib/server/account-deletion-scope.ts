import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import {
	alarm,
	alarmPerson,
	calendarEvent,
	calendarEventPerson,
	family,
	familyMember,
	familyPerson,
	invitation,
	kidGuardian,
	medication,
	oauthClient,
	paper,
	paperPerson,
	plannedTrip,
	plannedTripPerson,
	user,
	waitlist
} from './db/schema.ts';
import { familyScope, NoFamily, type AnyDb } from './family-scope.ts';
import { PAPERS_AREA_NAME } from './person-data.ts';
import { personFiles } from './person-files.ts';

/**
 * «Eliminar mi cuenta» (#315), on the database. What the account's foreign keys do not do by
 * themselves is done here before it goes: what is only theirs (their medication, the events and
 * papers only theirs) goes with it, what is shared with others stays, with their name.
 */

/**
 * What deleting would do:
 * - `stays`: the family goes on without them.
 * - `lastAdult`: there is no other adult: the family and its children's accounts go too.
 * - `handOverFirst`: they are its only administrator and there are other adults.
 * - `noFamily`: only the account.
 */
export type DeletionState =
	| { kind: 'stays' }
	| { kind: 'lastAdult'; kids: string[] }
	| { kind: 'handOverFirst' }
	| { kind: 'noFamily' };

export interface DeletionPlan {
	familyId: string | null;
	/** The family went too: all its files, not only theirs. */
	familyGone: boolean;
	files: { area: string; name: string }[];
	/** Children left with no adult to let them in, and who administers: to be told. */
	orphanKids: string[];
	admins: string[];
}

export function accountDeletionScope(db: AnyDb, { role }: { role?: string } = {}) {
	const withFamily = familyScope(db, { role });

	/** As their family sees it, or none. */
	async function inFamily<T>(userId: string, fn: Parameters<typeof withFamily<T>>[1]) {
		try {
			return { found: await withFamily(userId, fn) };
		} catch (error) {
			if (error instanceof NoFamily) return null;
			throw error;
		}
	}

	async function stateOf(userId: string): Promise<DeletionState> {
		const found = await inFamily<DeletionState>(userId, async (tx, m) => {
			const others = await tx
				.select({ role: familyMember.role, name: user.name })
				.from(familyMember)
				.innerJoin(user, eq(user.id, familyMember.userId))
				.where(ne(familyMember.userId, userId));
			const adults = others.filter((o) => o.role !== 'peque');
			if (!adults.length)
				return {
					kind: 'lastAdult',
					kids: others.map((o) => o.name).sort((a, b) => a.localeCompare(b, 'es'))
				};
			if (m.role === 'admin' && !adults.some((a) => a.role === 'admin'))
				return { kind: 'handOverFirst' };
			return { kind: 'stays' };
		});
		return found?.found ?? { kind: 'noFamily' };
	}

	/** Theirs out of the family, keeping what others share: the files to remove once it is done. */
	async function leaveFamily(tx: AnyDb, userId: string, name: string) {
		const [person] = await tx
			.select({ id: familyPerson.id })
			.from(familyPerson)
			.where(eq(familyPerson.userId, userId));
		const files: { area: string; name: string }[] = [];
		if (person) {
			await tx.delete(medication).where(eq(medication.personId, person.id));

			/** The rows of something for people that have only this person. */
			const onlyTheirs = async (table: PgTable, key: PgColumn, who: PgColumn) =>
				(
					await tx
						.select({ id: key })
						.from(table)
						.groupBy(key)
						.having(sql`count(*) = 1 and bool_and(${who} = ${person.id})`)
				).map((row) => row.id as number);

			const events = await onlyTheirs(
				calendarEventPerson,
				calendarEventPerson.eventId,
				calendarEventPerson.personId
			);
			const alarms = await onlyTheirs(alarmPerson, alarmPerson.alarmId, alarmPerson.personId);
			const trips = await onlyTheirs(
				plannedTripPerson,
				plannedTripPerson.tripId,
				plannedTripPerson.personId
			);
			const papers = await onlyTheirs(paperPerson, paperPerson.paperId, paperPerson.personId);
			if (events.length) await tx.delete(calendarEvent).where(inArray(calendarEvent.id, events));
			if (alarms.length) await tx.delete(alarm).where(inArray(alarm.id, alarms));
			if (trips.length) await tx.delete(plannedTrip).where(inArray(plannedTrip.id, trips));
			if (papers.length) {
				const gone = await tx
					.delete(paper)
					.where(inArray(paper.id, papers))
					.returning({ file: paper.file });
				files.push(...gone.map((p) => ({ area: PAPERS_AREA_NAME, name: p.file })));
			}

			// With someone else's event left, their name is what it says; with none, nothing is.
			const stillOn = async (table: PgTable, who: PgColumn) =>
				(await tx.select({ who }).from(table).where(eq(who, person.id)).limit(1)).length > 0;
			const kept =
				(await stillOn(calendarEventPerson, calendarEventPerson.personId)) ||
				(await stillOn(alarmPerson, alarmPerson.personId)) ||
				(await stillOn(plannedTripPerson, plannedTripPerson.personId)) ||
				(await stillOn(paperPerson, paperPerson.personId));
			if (kept) await tx.update(familyPerson).set({ name }).where(eq(familyPerson.id, person.id));
			else await tx.delete(familyPerson).where(eq(familyPerson.id, person.id));
		}
		// Private: seen by no one else, it would stay with no one.
		await tx
			.delete(plannedTrip)
			.where(and(eq(plannedTrip.userId, userId), eq(plannedTrip.private, true)));
		return files;
	}

	/** Everything before the account goes (auth.ts, Better Auth's `beforeDelete`). */
	async function prepare(userId: string, email: string, name: string): Promise<DeletionPlan> {
		const state = await stateOf(userId);
		if (state.kind === 'handOverFirst') throw new MustHandOver();

		const plan: DeletionPlan = {
			familyId: null,
			familyGone: state.kind === 'lastAdult',
			files: [],
			orphanKids: [],
			admins: []
		};

		if (state.kind === 'lastAdult') {
			const found = await withFamily(userId, async (tx, m) => {
				const kids = await tx
					.select({ id: familyMember.userId })
					.from(familyMember)
					.where(eq(familyMember.role, 'peque'));
				await tx.delete(family).where(eq(family.id, m.familyId));
				await tx.delete(oauthClient).where(eq(oauthClient.referenceId, m.familyId));
				return { familyId: m.familyId, kids: kids.map((k) => k.id) };
			});
			plan.familyId = found.familyId;
			if (found.kids.length) await db.delete(user).where(inArray(user.id, found.kids));
		}

		if (state.kind === 'stays') {
			const found = await withFamily(userId, async (tx, m) => {
				const kitchen = {
					familyId: m.familyId,
					userId,
					run: <T>(fn: (inner: AnyDb) => Promise<T>) => fn(tx)
				};
				const own = await personFiles(kitchen, userId);
				const papers = await leaveFamily(tx, userId, name);

				const mine = await tx
					.select({ kidId: kidGuardian.kidId })
					.from(kidGuardian)
					.where(eq(kidGuardian.guardianId, userId));
				const kidIds = mine.map((k) => k.kidId);
				const others = kidIds.length
					? await tx
							.select({ kidId: kidGuardian.kidId })
							.from(kidGuardian)
							.where(and(inArray(kidGuardian.kidId, kidIds), ne(kidGuardian.guardianId, userId)))
					: [];
				const covered = new Set(others.map((o) => o.kidId));
				const orphans = kidIds.filter((id) => !covered.has(id));
				const orphanKids = orphans.length
					? await tx
							.select({ name: user.name })
							.from(user)
							.where(inArray(user.id, orphans))
							.then((rows) => rows.map((r) => r.name))
					: [];
				const admins = await tx
					.select({ id: familyMember.userId })
					.from(familyMember)
					.where(and(eq(familyMember.role, 'admin'), ne(familyMember.userId, userId)));
				return {
					familyId: m.familyId,
					files: [...own, ...papers],
					orphanKids,
					admins: admins.map((a) => a.id)
				};
			});
			Object.assign(plan, found);
		}

		// Who was invited or asked to come in, by their address: of no family, and theirs.
		const address = email.trim().toLowerCase();
		await db.delete(invitation).where(eq(sql`lower(${invitation.email})`, address));
		await db.delete(waitlist).where(eq(sql`lower(${waitlist.email})`, address));
		return plan;
	}

	return { stateOf, prepare };
}

/** Told when it is asked, and again in case things changed since. */
export class MustHandOver extends Error {
	constructor() {
		super('Antes de eliminar tu cuenta, pasa la administración a otro adulto');
	}
}
