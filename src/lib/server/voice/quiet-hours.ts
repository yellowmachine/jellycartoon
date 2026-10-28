import { getAppSetting, setAppSetting } from '#lib/server/app-settings.ts';
import type { QuietHours } from '#lib/server/voice/quiet-check.ts';
import { parseClock } from '#lib/kid-time.ts';

/**
 * «Horas de silencio» (Ajustes → Casa): at night, a voice order that would start something sounding
 * (music, radio, an episode) is only done after a «sí» in another order, which the server asks for,
 * not the AI, as with Telegram (#243). An order heard wrong at four in the morning stays a question.
 * What is put on from a screen, the alarms and the timers, and stopping or turning down, never ask.
 */

export async function quietHoursConfig(): Promise<QuietHours | null> {
	try {
		const saved = JSON.parse((await getAppSetting('voice_quiet')) ?? 'null');
		return saved && parseClock(saved.from) !== null && parseClock(saved.to) !== null
			? { from: saved.from, to: saved.to }
			: null;
	} catch {
		return null;
	}
}

/** `null`, none. Equal ends are none too: silence all day would be a muted voice. */
export async function setQuietHours(config: QuietHours | null) {
	const ok =
		config &&
		parseClock(config.from) !== null &&
		parseClock(config.to) !== null &&
		config.from !== config.to;
	await setAppSetting('voice_quiet', ok ? JSON.stringify(config) : null);
}
