import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { kidSettings } from '#lib/server/db/schema.ts';
import { isKidAccount } from '#lib/server/kids.ts';
import { ASK_EVERY_DEFAULT } from '#lib/still-there.ts';

/**
 * After how many episodes started by themselves to ask this user «¿Sigues ahí?» (#77); null,
 * never. Children, as chosen in /infantil (3 until then).
 */
export async function askEvery(userId: string): Promise<number | null> {
	if (!(await isKidAccount(userId))) return null;
	const [settings] = await db
		.select({ askEvery: kidSettings.askEvery })
		.from(kidSettings)
		.where(eq(kidSettings.userId, userId));
	return settings ? settings.askEvery : ASK_EVERY_DEFAULT;
}
