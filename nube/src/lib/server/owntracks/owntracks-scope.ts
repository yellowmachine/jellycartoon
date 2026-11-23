import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, gt, gte, lt, min, sql } from 'drizzle-orm';
import {
	locationPoint,
	owntracksDay,
	owntracksEvent,
	owntracksLink
} from '../db/owntracks.schema.ts';
import { userScope, type AnyDb } from '../family-scope.ts';
import { hashOf } from '../house-key-scope.ts';
import type { OwntracksPoint, OwntracksTransition } from '#lib/owntracks.ts';
import { walkingOutings } from '#lib/owntracks-walking.ts';

/**
 * OwnTracks (#593) on the database: a person's connection and their positions, theirs only
 * (`asUser`). Whose a password is, found by its hash alone, as the bank's calls (bank-key-scope.ts).
 * Apart from the app's database, to be tested on PGlite.
 */

/**
 * The least time between two kept positions of a person: Move asks for one every 15 s, and the
 * walking sums (owntracks-walking.ts) need nothing closer.
 */
export const MIN_GAP_MS = 10_000;

/** base64url of 32 random bytes. */
export const PASSWORD = /^[\w-]{43}$/;

export function owntracksScope(db: AnyDb, { role }: { role?: string } = {}) {
	const asUser = userScope(db, { role });

	/** The person of a password, or null: Postgres is told only its hash (`app.key_hash`). */
	async function userOf(password: string | null): Promise<string | null> {
		if (!password || !PASSWORD.test(password)) return null;
		const hash = hashOf(password);
		return db.transaction(async (tx) => {
			if (role) await tx.execute(sql`select set_config('role', ${role}, true)`);
			await tx.execute(sql`select set_config('app.key_hash', ${hash}, true)`);
			const [found] = await tx
				.select({ userId: owntracksLink.userId })
				.from(owntracksLink)
				.where(eq(owntracksLink.tokenHash, hash));
			return found?.userId ?? null;
		});
	}

	/** A new password, replacing theirs: shown once, kept only as its hash. */
	function connect(userId: string) {
		const password = randomBytes(32).toString('base64url');
		const tokenHash = hashOf(password);
		return asUser(userId, async (tx) => {
			await tx
				.insert(owntracksLink)
				.values({ userId, tokenHash })
				.onConflictDoUpdate({
					target: owntracksLink.userId,
					set: { tokenHash, createdAt: new Date() }
				});
			return password;
		});
	}

	/** Their password forgotten: their OwnTracks gets 401 from now on. Their positions stay. */
	function disconnect(userId: string) {
		return asUser(userId, (tx) => tx.delete(owntracksLink).where(eq(owntracksLink.userId, userId)));
	}

	/** All their positions, arrivals, and what was left of the old days, gone. */
	function forget(userId: string) {
		return asUser(userId, async (tx) => {
			await tx.delete(locationPoint).where(eq(locationPoint.userId, userId));
			await tx.delete(owntracksDay).where(eq(owntracksDay.userId, userId));
			await tx.delete(owntracksEvent).where(eq(owntracksEvent.userId, userId));
		});
	}

	/** One position; the same moment again (sent twice), kept once. */
	/**
	 * Keeps a position, unless one of theirs is less than MIN_GAP_MS from it (either side, as queued
	 * ones arrive late): a phone sending every second (another app asking for the GPS) fills nothing.
	 * Whether it was kept.
	 */
	function save(userId: string, p: OwntracksPoint) {
		return asUser(userId, async (tx) => {
			const [near] = await tx
				.select({ at: locationPoint.at })
				.from(locationPoint)
				.where(
					and(
						eq(locationPoint.userId, userId),
						gt(locationPoint.at, new Date(p.at.getTime() - MIN_GAP_MS)),
						lt(locationPoint.at, new Date(p.at.getTime() + MIN_GAP_MS))
					)
				)
				.limit(1);
			if (near) return false;
			const kept = await tx
				.insert(locationPoint)
				.values({ userId, ...p })
				.onConflictDoNothing()
				.returning({ at: locationPoint.at });
			return kept.length > 0;
		});
	}

	/** Whether they are connected and since when, their last position as it came, and if anything is kept. */
	function status(userId: string) {
		return asUser(userId, async (tx) => {
			const [link] = await tx
				.select({ createdAt: owntracksLink.createdAt })
				.from(owntracksLink)
				.where(eq(owntracksLink.userId, userId));
			const [last] = await tx
				.select({
					at: locationPoint.at,
					receivedAt: locationPoint.receivedAt,
					battery: locationPoint.battery,
					device: locationPoint.device
				})
				.from(locationPoint)
				.where(eq(locationPoint.userId, userId))
				.orderBy(desc(locationPoint.at))
				.limit(1);
			const [old] = await tx
				.select({ day: owntracksDay.day })
				.from(owntracksDay)
				.where(eq(owntracksDay.userId, userId))
				.limit(1);
			return {
				connectedAt: link?.createdAt ?? null,
				last: last ?? null,
				/** Whether anything of theirs is kept: positions, or old days summed up. */
				kept: !!last || !!old
			};
		});
	}

	/** Their positions between two moments, in order: a day's way. */
	function between(userId: string, from: Date, to: Date) {
		return asUser(userId, (tx) =>
			tx
				.select({
					at: locationPoint.at,
					lon: locationPoint.lon,
					lat: locationPoint.lat,
					accuracy: locationPoint.accuracy,
					speed: locationPoint.speed
				})
				.from(locationPoint)
				.where(
					and(
						eq(locationPoint.userId, userId),
						gte(locationPoint.at, from),
						lt(locationPoint.at, to)
					)
				)
				.orderBy(asc(locationPoint.at))
		);
	}

	/** Arriving at or leaving a place (phase 4): true if new, false if it had come already. */
	async function saveTransition(userId: string, t: OwntracksTransition) {
		const added = await asUser(userId, (tx) =>
			tx
				.insert(owntracksEvent)
				.values({ userId, ...t })
				.onConflictDoNothing()
				.returning({ at: owntracksEvent.at })
		);
		return added.length > 0;
	}

	/** Their arrivals and leavings between two moments, in order. */
	function transitionsBetween(userId: string, from: Date, to: Date) {
		return asUser(userId, (tx) =>
			tx
				.select({
					at: owntracksEvent.at,
					place: owntracksEvent.place,
					moment: owntracksEvent.moment
				})
				.from(owntracksEvent)
				.where(
					and(
						eq(owntracksEvent.userId, userId),
						gte(owntracksEvent.at, from),
						lt(owntracksEvent.at, to)
					)
				)
				.orderBy(asc(owntracksEvent.at))
		);
	}

	/** What is left of a day whose positions were forgotten, or null. */
	async function summaryOf(userId: string, day: string) {
		const [row] = await asUser(userId, (tx) =>
			tx
				.select()
				.from(owntracksDay)
				.where(and(eq(owntracksDay.userId, userId), eq(owntracksDay.day, day)))
		);
		return row ?? null;
	}

	/** Their first day with anything: a summary's, or a position's. */
	async function firstDay(userId: string, dayOf: (at: Date) => string) {
		return asUser(userId, async (tx) => {
			const [summary] = await tx
				.select({ day: min(owntracksDay.day) })
				.from(owntracksDay)
				.where(eq(owntracksDay.userId, userId));
			const [point] = await tx
				.select({ at: min(locationPoint.at) })
				.from(locationPoint)
				.where(eq(locationPoint.userId, userId));
			const days = [summary?.day, point?.at && dayOf(point.at)].filter((d): d is string => !!d);
			return days.sort()[0] ?? null;
		});
	}

	/**
	 * Every night (phase 3): the positions of the days before `firstKept`, summed up by day and
	 * forgotten. A day already summed up keeps its summary: a night that failed half way, or a
	 * position of that day that came late, would leave it with fewer than it had.
	 */
	async function summarizeOld(
		userId: string,
		firstKept: string,
		{
			dayStart,
			dayOf,
			nextDay,
			appWalks
		}: {
			/** The instant a house's day starts. */
			dayStart: (day: string) => Date;
			dayOf: (at: Date) => string;
			nextDay: (day: string) => string;
			/** Their walks in the app, left out as on the page. */
			appWalks: () => Promise<{ startedAt: Date; endedAt: Date }[]>;
		}
	) {
		const cutoff = dayStart(firstKept);
		// Their arrivals of those days (phase 4): nothing is left of them in the summary.
		await asUser(userId, (tx) =>
			tx
				.delete(owntracksEvent)
				.where(and(eq(owntracksEvent.userId, userId), lt(owntracksEvent.at, cutoff)))
		);
		const [oldest] = await asUser(userId, (tx) =>
			tx
				.select({ at: min(locationPoint.at) })
				.from(locationPoint)
				.where(and(eq(locationPoint.userId, userId), lt(locationPoint.at, cutoff)))
		);
		if (!oldest?.at) return 0;
		const walks = await appWalks();
		let days = 0;
		for (let day = dayOf(oldest.at); day < firstKept; day = nextDay(day)) {
			const points = await between(userId, dayStart(day), dayStart(nextDay(day)));
			if (!points.length) continue;
			const outings = walkingOutings(points, walks);
			const summary = {
				distance: outings.reduce((sum, o) => sum + o.distance, 0),
				seconds: Math.round(
					outings.reduce((sum, o) => sum + (o.endedAt.getTime() - o.startedAt.getTime()) / 1000, 0)
				),
				outings: outings.length,
				points: points.length
			};
			await asUser(userId, (tx) =>
				tx
					.insert(owntracksDay)
					.values({ userId, day, ...summary })
					.onConflictDoNothing()
			);
			days++;
		}
		await asUser(userId, (tx) =>
			tx
				.delete(locationPoint)
				.where(and(eq(locationPoint.userId, userId), lt(locationPoint.at, cutoff)))
		);
		return days;
	}

	return {
		userOf,
		connect,
		disconnect,
		forget,
		save,
		status,
		between,
		summaryOf,
		firstDay,
		summarizeOld,
		saveTransition,
		transitionsBetween
	};
}
