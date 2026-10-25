import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { userSettings } from '#lib/server/db/schema.ts';
import { sanitizeSubtitleStyle, type SubtitleStyle } from '#lib/subtitle-style.ts';
import { DEFAULT_THEME, isTheme, type ThemeId } from '#lib/themes.ts';

export interface PlaybackSettings {
	audioLang: string | null;
	subtitleLang: string | null;
	subtitleStyle: SubtitleStyle;
	autoNext: boolean;
	intro: boolean;
	/** One the app no longer has is the default. */
	theme: ThemeId;
	keepHistory: boolean;
	/** A line from the library on a black screen when the app opens, as Frasier's title cards. */
	openingQuote: boolean;
	/** Modo DJ: the DJ speaks over the songs, as on the radio, instead of between them. */
	djMix: boolean;
}

export async function getSettings(userId: string): Promise<PlaybackSettings> {
	const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
	return {
		audioLang: row?.audioLang ?? null,
		subtitleLang: row?.subtitleLang ?? null,
		subtitleStyle: sanitizeSubtitleStyle(row?.subtitleStyle),
		autoNext: row?.autoNext ?? true,
		intro: row?.intro ?? true,
		theme: isTheme(row?.theme) ? row.theme : DEFAULT_THEME,
		keepHistory: row?.keepHistory ?? true,
		openingQuote: row?.openingQuote ?? true,
		djMix: row?.djMix ?? false
	};
}

/** Whether each adult keeps what they watch: asked every few seconds while playing, so in memory. */
const keepsHistoryCache = new Map<string, boolean>();

export async function keepsHistory(userId: string) {
	let keep = keepsHistoryCache.get(userId);
	if (keep === undefined) {
		keep = (await getSettings(userId)).keepHistory;
		keepsHistoryCache.set(userId, keep);
	}
	return keep;
}

/** «Guardar lo que veo», in Ajustes: off deletes nothing already kept. */
export async function setKeepHistory(userId: string, keepHistory: boolean) {
	await db
		.insert(userSettings)
		.values({ userId, keepHistory })
		.onConflictDoUpdate({ target: userSettings.userId, set: { keepHistory } });
	keepsHistoryCache.set(userId, keepHistory);
}
