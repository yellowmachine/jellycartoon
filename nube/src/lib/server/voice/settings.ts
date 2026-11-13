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

/**
 * «Modelo para conversar»: what the fast one hands over the questions to think about (an opinion,
 * philosophy, a long explanation), in a few spoken sentences (converse.ts). Slower and dearer.
 */
export const DEFAULT_CONVERSATION_MODEL = 'anthropic/claude-sonnet-5.5';

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
	conversationModel: string;
	savedConversationModel: string | null;
	style: string | null;
	web: WebSearchConfig;
	quiet: QuietHours | null;
	/** «Aprender de lo que se habla» (#331). */
	learn: boolean;
	/** «Quién oye lo que se dice»: OpenRouter always, even with a house. */
	hearCloud: boolean;
}

const validQuiet = (q: QuietHours | null | undefined): q is QuietHours =>
	Boolean(q && parseClock(q.from) !== null && parseClock(q.to) !== null && q.from !== q.to);

export async function voiceSettings(k: Kitchen): Promise<VoiceSettings> {
	const [row] = await k.run((tx) => tx.select().from(familySettings));
	return {
		model: row?.voiceModel ?? DEFAULT_VOICE_MODEL,
		savedModel: row?.voiceModel ?? null,
		conversationModel: row?.conversationModel ?? DEFAULT_CONVERSATION_MODEL,
		savedConversationModel: row?.conversationModel ?? null,
		style: row?.voiceStyle ?? null,
		web: {
			on: row?.voiceWeb?.on === true,
			hints: (row?.voiceWeb?.hints ?? '').slice(0, MAX_WEB_HINTS)
		},
		quiet: validQuiet(row?.voiceQuiet) ? row.voiceQuiet : null,
		learn: row?.voiceLearn ?? false,
		hearCloud: row?.voiceHearCloud ?? false
	};
}

type Saved = Partial<
	Pick<
		typeof familySettings.$inferInsert,
		| 'voiceModel'
		| 'conversationModel'
		| 'voiceStyle'
		| 'voiceWeb'
		| 'voiceQuiet'
		| 'voiceLearn'
		| 'voiceHearCloud'
	>
>;

async function save(k: Kitchen, set: Saved) {
	await k.run((tx) =>
		tx
			.insert(familySettings)
			.values({ familyId: k.familyId, ...set })
			.onConflictDoUpdate({ target: familySettings.familyId, set })
	);
}

/** An empty one goes back to the default; the same for the conversation's. */
export const setVoiceModel = (k: Kitchen, model: string | null, conversation: string | null) =>
	save(k, { voiceModel: model || null, conversationModel: conversation || null });

export const setVoiceStyle = (k: Kitchen, text: string) =>
	save(k, { voiceStyle: text.trim().slice(0, MAX_VOICE_STYLE) || null });

export const setWebSearch = (k: Kitchen, config: WebSearchConfig) =>
	save(k, { voiceWeb: { on: config.on, hints: config.hints.trim().slice(0, MAX_WEB_HINTS) } });

/** «Aprender de lo que se habla» (#331), on or off. */
export const setVoiceLearn = (k: Kitchen, on: boolean) => save(k, { voiceLearn: on });

/**
 * Whether what is said is heard by the house's Whisper (when there is a house): not when the
 * family chose OpenRouter always («Quién oye lo que se dice»).
 */
export async function hearsByHouse(k: Kitchen) {
	const [row] = await k.run((tx) =>
		tx.select({ cloud: familySettings.voiceHearCloud }).from(familySettings)
	);
	return !row?.cloud;
}

/** OpenRouter always, or the house's Whisper first (then tell the satellites: satellitesChanged). */
export const setHearCloud = (k: Kitchen, cloud: boolean) => save(k, { voiceHearCloud: cloud });

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
