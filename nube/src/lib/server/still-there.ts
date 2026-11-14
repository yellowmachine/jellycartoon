import { eq, inArray } from 'drizzle-orm';
import { db } from './db/index.ts';
import { user } from './db/schema.ts';
import { askAfterOf, setAskAfter } from './series.ts';

/**
 * «¿Sigues ahí?» (#77) in Ajustes: kept at home (its Ajustes and /infantil), read and changed
 * from here. Children's (#303) as the house knows them, by their own email and name.
 */

/** Theirs, and each child's (by user id), as the house has them; null where it did not answer. */
export async function stillThereSettings(me: { id: string; email: string }, kidIds: string[]) {
	const kids = kidIds.length
		? await db.select({ id: user.id, email: user.email }).from(user).where(inArray(user.id, kidIds))
		: [];
	const read = (who: { id: string; email: string }) => askAfterOf(who).catch(() => undefined);
	const [mine, ...theirs] = await Promise.all([read(me), ...kids.map(read)]);
	return {
		/** Undefined: the house did not say (off, or older than this). */
		mine,
		kids: Object.fromEntries(kids.map((kid, i) => [kid.id, theirs[i]]))
	};
}

/** A child's, changed by who runs the family. */
export async function setKidAskAfter(kidId: string, askAfter: number | null) {
	const [kid] = await db
		.select({ id: user.id, email: user.email })
		.from(user)
		.where(eq(user.id, kidId));
	if (!kid) return false;
	await setAskAfter(kid, askAfter);
	return true;
}
