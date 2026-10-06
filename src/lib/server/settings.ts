import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { userSettings } from '#lib/server/db/schema.ts';

export interface PlaybackSettings {
	audioLang: string | null;
	subtitleLang: string | null;
}

export async function getSettings(userId: string): Promise<PlaybackSettings> {
	const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
	return { audioLang: row?.audioLang ?? null, subtitleLang: row?.subtitleLang ?? null };
}
