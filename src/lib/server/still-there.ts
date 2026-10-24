import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { kidSettings, userSettings } from '#lib/server/db/schema.ts';
import { isKidAccount } from '#lib/server/kids.ts';
import { watchersOf } from '#lib/server/watching-together.ts';
import { ASK_EVERY_DEFAULT } from '#lib/still-there.ts';

/**
 * After how many episodes started by themselves to ask this user «¿Sigues ahí?» (#77); null,
 * never. Children, as chosen in /infantil (3 until then); adults, in Ajustes (never until then).
 */
export async function askEvery(userId: string): Promise<number | null> {
	if (!(await isKidAccount(userId))) {
		const [settings] = await db
			.select({ askEvery: userSettings.askEvery })
			.from(userSettings)
			.where(eq(userSettings.userId, userId));
		return settings?.askEvery ?? null;
	}
	const [settings] = await db
		.select({ askEvery: kidSettings.askEvery })
		.from(kidSettings)
		.where(eq(kidSettings.userId, userId));
	return settings ? settings.askEvery : ASK_EVERY_DEFAULT;
}

/** Watching together (#160): the lowest number of theirs; never, only if never for all. */
export async function askEveryTogether(userId: string, sessionId?: string) {
	return lowestAskEvery(await Promise.all((await watchersOf(userId, sessionId)).map(askEvery)));
}

/** The lowest of those set; null (never) only if none is. */
export function lowestAskEvery(numbers: (number | null)[]) {
	const set = numbers.filter((n): n is number => n !== null);
	return set.length ? Math.min(...set) : null;
}
