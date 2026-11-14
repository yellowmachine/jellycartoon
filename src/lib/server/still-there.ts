import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { kidSettings, userSettings } from '#lib/server/db/schema.ts';
import { isKidAccount } from '#lib/server/kids.ts';
import { watchersOf } from '#lib/server/watching-together.ts';
import { ASK_AFTER_DEFAULT, ASK_AFTER_OPTIONS } from 'comun/still-there.ts';

/**
 * After how many minutes with nobody touching anything to ask this user «¿Sigues ahí?» (#77), as
 * the next episode starts by itself; null, never. Children, as chosen in /infantil (1 h 30 until
 * then); adults, in Ajustes (never until then).
 */
export async function askAfter(userId: string): Promise<number | null> {
	if (!(await isKidAccount(userId))) {
		const [settings] = await db
			.select({ askAfterMin: userSettings.askAfterMin })
			.from(userSettings)
			.where(eq(userSettings.userId, userId));
		return settings?.askAfterMin ?? null;
	}
	const [settings] = await db
		.select({ askAfterMin: kidSettings.askAfterMin })
		.from(kidSettings)
		.where(eq(kidSettings.userId, userId));
	return settings ? settings.askAfterMin : ASK_AFTER_DEFAULT;
}

/** Watching together (#160): the shortest of theirs; never, only if never for all. */
export async function askAfterTogether(userId: string, sessionId?: string) {
	return shortestAskAfter(await Promise.all((await watchersOf(userId, sessionId)).map(askAfter)));
}

/** The shortest of those set; null (never) only if none is. */
export function shortestAskAfter(minutes: (number | null)[]) {
	const set = minutes.filter((n): n is number => n !== null);
	return set.length ? Math.min(...set) : null;
}

/** One of the choices (minutes), or null (never); anything else, undefined. */
export function askAfterChoice(value: unknown): number | null | undefined {
	if (value === null) return null;
	return (ASK_AFTER_OPTIONS as readonly number[]).includes(value as number)
		? (value as number)
		: undefined;
}

/** Saves this user's «¿Sigues ahí?»: a child's where /infantil keeps it, an adult's in Ajustes. */
export async function setAskAfter(userId: string, minutes: number | null) {
	if (await isKidAccount(userId))
		await db
			.insert(kidSettings)
			.values({ userId, askAfterMin: minutes })
			.onConflictDoUpdate({ target: kidSettings.userId, set: { askAfterMin: minutes } });
	else
		await db
			.insert(userSettings)
			.values({ userId, askAfterMin: minutes })
			.onConflictDoUpdate({ target: userSettings.userId, set: { askAfterMin: minutes } });
}
