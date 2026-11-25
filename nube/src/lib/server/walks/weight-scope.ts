import { and, asc, eq } from 'drizzle-orm';
import { bodyWeight } from '../db/weight.schema.ts';
import { userScope, type AnyDb } from '../family-scope.ts';
import type { Weight } from '#lib/walk-kcal.ts';

/** A person's weight, by the day they noted it (Ajustes): theirs only. Apart, to be tested on PGlite. */
export function weightScope(db: AnyDb, { role }: { role?: string } = {}) {
	const asUser = userScope(db, { role });
	return {
		/** From the first one. */
		list: (userId: string): Promise<Weight[]> =>
			asUser(userId, (tx) =>
				tx
					.select({ day: bodyWeight.day, kg: bodyWeight.kg })
					.from(bodyWeight)
					.where(eq(bodyWeight.userId, userId))
					.orderBy(asc(bodyWeight.day))
			),
		/** Noted twice the same day, the last one. */
		save: (userId: string, { day, kg }: Weight) =>
			asUser(userId, async (tx) => {
				await tx
					.insert(bodyWeight)
					.values({ userId, day, kg })
					.onConflictDoUpdate({ target: [bodyWeight.userId, bodyWeight.day], set: { kg } });
			}),
		remove: (userId: string, day: string) =>
			asUser(userId, async (tx) => {
				await tx
					.delete(bodyWeight)
					.where(and(eq(bodyWeight.userId, userId), eq(bodyWeight.day, day)));
			})
	};
}
