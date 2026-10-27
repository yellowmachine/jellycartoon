/**
 * How the voice satellites sound over the music (#223), in Ajustes → Casa: their voice louder, and
 * the music lower while it speaks. In dB.
 */

export interface VoiceLevels {
	/** Added to Piper's voice. */
	gainDb: number;
	/** The music while it speaks (PulseAudio's role ducking, deploy/pulse.pa). */
	duckDb: number;
}

export const VOICE_GAIN = { min: 0, max: 12, default: 0 };
/** −12 dB, as the phone's (music-player.svelte.ts, a quarter), and deploy/pulse.pa's. */
export const MUSIC_DUCK = { min: -30, max: -6, default: -12 };

const within = (value: unknown, range: { min: number; max: number; default: number }) => {
	const n = typeof value === 'string' && value.trim() ? Number(value) : value;
	return typeof n === 'number' && Number.isFinite(n)
		? Math.round(Math.min(range.max, Math.max(range.min, n)))
		: range.default;
};

/** Saved or sent ones, within their ranges; the default for each one missing. */
export function parseVoiceLevels(value: unknown): VoiceLevels {
	const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
	return { gainDb: within(v.gainDb, VOICE_GAIN), duckDb: within(v.duckDb, MUSIC_DUCK) };
}
