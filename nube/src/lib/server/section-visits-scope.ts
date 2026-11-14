import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { sectionVisit } from './db/user.schema.ts';
import type { AnyDb } from './family-scope.ts';

/**
 * Which sections each person opens, for /admin's «Qué usa»: the page says where it went
 * (/api/visita, after each navigation, not on a link's preload), and it is counted at most once
 * every half hour for each person and section, so that reloads and saved forms do not add up.
 * Only the section and when. Apart from the app's database, to be tested on PGlite.
 */

/** A section counted again for the same person only after this. */
export const VISIT_GAP_MS = 30 * 60_000;
/** Kept this long; older, forgotten every night. */
export const VISITS_KEPT_DAYS = 90;
/** What «Qué usa» sums up: the last week. */
export const USAGE_DAYS = 7;

export interface SectionUsage {
	userId: string;
	section: string;
	visits: number;
	lastAt: Date;
}

export interface VisitDeps {
	asUser: <T>(userId: string, fn: (tx: AnyDb) => Promise<T>) => Promise<T>;
	today: () => string;
	now?: () => number;
}

const addDays = (day: string, by: number) => {
	const d = new Date(`${day}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + by);
	return d.toISOString().slice(0, 10);
};

export function sectionVisits(
	db: AnyDb,
	{ asUser, today, now = Date.now }: VisitDeps,
	{ role }: { role?: string } = {}
) {
	const asAdmin = <T>(fn: (tx: AnyDb) => Promise<T>): Promise<T> =>
		db.transaction(async (tx) => {
			if (role) await tx.execute(sql`select set_config('role', ${role}, true)`);
			await tx.execute(sql`select set_config('app.is_admin', 'true', true)`);
			return fn(tx as unknown as AnyDb);
		});

	/** `user|section` → when it was last counted. */
	const counted = new Map<string, number>();

	return {
		/** A visit to that section; not counted if it was, for them, within the last half hour. */
		async record(userId: string, section: string) {
			const key = `${userId}|${section}`;
			const at = now();
			if (at - (counted.get(key) ?? -Infinity) < VISIT_GAP_MS) return false;
			counted.set(key, at);
			// Not to grow for ever: the old ones would be counted again anyway.
			if (counted.size > 10_000)
				for (const [k, t] of counted) if (at - t >= VISIT_GAP_MS) counted.delete(k);
			const lastAt = new Date(at);
			await asUser(userId, (tx) =>
				tx
					.insert(sectionVisit)
					.values({ userId, section, day: today(), visits: 1, lastAt })
					.onConflictDoUpdate({
						target: [sectionVisit.userId, sectionVisit.section, sectionVisit.day],
						set: { visits: sql`${sectionVisit.visits} + 1`, lastAt }
					})
			);
			return true;
		},

		/** Every person's sections of the last USAGE_DAYS days (today too): visits and the last one. */
		usage(): Promise<SectionUsage[]> {
			const since = addDays(today(), -(USAGE_DAYS - 1));
			return asAdmin((tx) =>
				tx
					.select({
						userId: sectionVisit.userId,
						section: sectionVisit.section,
						visits: sql<number>`sum(${sectionVisit.visits})::int`,
						lastAt: sql<Date>`max(${sectionVisit.lastAt})`
					})
					.from(sectionVisit)
					.where(gte(sectionVisit.day, since))
					.groupBy(sectionVisit.userId, sectionVisit.section)
			).then((rows) => rows.map((r) => ({ ...r, lastAt: new Date(r.lastAt) })));
		},

		/** Each person's last visit to anything, ever kept: more exact than their session's day. */
		lastVisits(): Promise<Map<string, Date>> {
			return asAdmin((tx) =>
				tx
					.select({
						userId: sectionVisit.userId,
						lastAt: sql<Date>`max(${sectionVisit.lastAt})`
					})
					.from(sectionVisit)
					.groupBy(sectionVisit.userId)
			).then((rows) => new Map(rows.map((r) => [r.userId, new Date(r.lastAt)])));
		},

		/** Those of over VISITS_KEPT_DAYS days ago, gone: every night. */
		async forgetOld() {
			const before = addDays(today(), -VISITS_KEPT_DAYS);
			await asAdmin((tx) => tx.delete(sectionVisit).where(lt(sectionVisit.day, before)));
		},

		/** Theirs, for their zip and tests: by section and day. */
		mine(userId: string) {
			return asUser(userId, (tx) =>
				tx
					.select()
					.from(sectionVisit)
					.where(and(eq(sectionVisit.userId, userId)))
			);
		}
	};
}
