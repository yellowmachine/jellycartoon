import { eq } from 'drizzle-orm';
import { familyMember, familySettings } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { parseClock } from 'comun/clock.ts';
import { MAX_VOICE_STYLE } from 'comun/voice.ts';
import type { QuietHours } from './quiet-check.ts';

/**
 * How the family's voice is (Ajustes → La voz, #253; jellycartoon's Ajustes → Casa until then): its
 * model, its character, the web and the «horas de silencio»; and how it talks to each person.
 */

/** jellycartoon's: fast, and good with the tools. */
export const DEFAULT_VOICE_MODEL = 'anthropic/claude-haiku-5.5';

/**
 * When the family's fails (its providers gone, retired, down): another company's, fast without
 * thinking and good with the tools (tried on 2026-10-29: ~0.6 s for a timer).
 */
export const FALLBACK_VOICE_MODEL = 'google/gemini-2.5-flash';

/** «Indicaciones para buscar», this long at most. */
export const MAX_WEB_HINTS = 500;

export interface WebSearchConfig {
	on: boolean;
	hints: string;
}

export interface VoiceSettings {
	model: string;
	/** Exactly as saved: empty, the default. */
	savedModel: string | null;
	style: string | null;
	web: WebSearchConfig;
	quiet: QuietHours | null;
}

const validQuiet = (q: QuietHours | null | undefined): q is QuietHours =>
	Boolean(q && parseClock(q.from) !== null && parseClock(q.to) !== null && q.from !== q.to);

export async function voiceSettings(k: Kitchen): Promise<VoiceSettings> {
	const [row] = await k.run((tx) => tx.select().from(familySettings));
	return {
		model: row?.voiceModel ?? DEFAULT_VOICE_MODEL,
		savedModel: row?.voiceModel ?? null,
		style: row?.voiceStyle ?? null,
		web: {
			on: row?.voiceWeb?.on === true,
			hints: (row?.voiceWeb?.hints ?? '').slice(0, MAX_WEB_HINTS)
		},
		quiet: validQuiet(row?.voiceQuiet) ? row.voiceQuiet : null
	};
}

type Saved = Partial<
	Pick<typeof familySettings.$inferInsert, 'voiceModel' | 'voiceStyle' | 'voiceWeb' | 'voiceQuiet'>
>;

async function save(k: Kitchen, set: Saved) {
	await k.run((tx) =>
		tx
			.insert(familySettings)
			.values({ familyId: k.familyId, ...set })
			.onConflictDoUpdate({ target: familySettings.familyId, set })
	);
}

/** An empty one goes back to the default. */
export const setVoiceModel = (k: Kitchen, model: string | null) =>
	save(k, { voiceModel: model || null });

export const setVoiceStyle = (k: Kitchen, text: string) =>
	save(k, { voiceStyle: text.trim().slice(0, MAX_VOICE_STYLE) || null });

export const setWebSearch = (k: Kitchen, config: WebSearchConfig) =>
	save(k, { voiceWeb: { on: config.on, hints: config.hints.trim().slice(0, MAX_WEB_HINTS) } });

/** `null`, none. Equal ends are none too: silence all day would be a muted voice. */
export const setQuietHours = (k: Kitchen, hours: QuietHours | null) =>
	save(k, { voiceQuiet: validQuiet(hours) ? hours : null });

/** «Cómo quieres que te hable»: theirs; null, none. */
export async function personVoiceStyle(k: Kitchen, userId: string) {
	const [row] = await k.run((tx) =>
		tx
			.select({ style: familyMember.voiceStyle })
			.from(familyMember)
			.where(eq(familyMember.userId, userId))
	);
	return row?.style ?? null;
}

export async function setPersonVoiceStyle(k: Kitchen, userId: string, text: string) {
	const voiceStyle = text.trim().slice(0, MAX_VOICE_STYLE) || null;
	await k.run((tx) =>
		tx.update(familyMember).set({ voiceStyle }).where(eq(familyMember.userId, userId))
	);
}
