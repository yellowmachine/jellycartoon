import { eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { gameSession, userSettings, watchTime } from '#lib/server/db/schema.ts';
import { sanitizeSubtitleStyle, type SubtitleStyle } from 'comun/subtitle-style.ts';
import { DEFAULT_THEME, isTheme, type ThemeId } from 'comun/themes.ts';

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
	/** The month's AI spending under the header (#193). */
	spendLine: boolean;
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
		djMix: row?.djMix ?? false,
		spendLine: row?.spendLine ?? false
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

/**
 * «Guardar lo que veo», in Ajustes: off deletes nothing kept here, and what Seilide has of them, yes
 * (#421). So nothing kept here is sent there again if it is turned on later, only what comes next.
 */
export async function setKeepHistory(userId: string, keepHistory: boolean) {
	await db.transaction(async (tx) => {
		const off = keepHistory ? {} : { forgetSentWatch: true };
		await tx
			.insert(userSettings)
			.values({ userId, keepHistory, ...off })
			.onConflictDoUpdate({ target: userSettings.userId, set: { keepHistory, ...off } });
		if (!keepHistory) {
			await tx
				.update(watchTime)
				.set({ sentSeconds: sql`${watchTime.seconds}` })
				.where(eq(watchTime.userId, userId));
			await tx
				.update(gameSession)
				.set({ sentSeconds: sql`${gameSession.seconds}` })
				.where(eq(gameSession.userId, userId));
		}
	});
	keepsHistoryCache.set(userId, keepHistory);
}
