/**
 * How the voice satellites sound (#223), in Ajustes → Casa: their voice louder, the music lower
 * while it speaks (in dB), and how Piper reads (in %, 100 its own way).
 */

export interface VoiceLevels {
	/** Added to Piper's voice. */
	gainDb: number;
	/** The music while it speaks (PulseAudio's role ducking, deploy/pulse.pa). */
	duckDb: number;
	/** How much the intonation and the rhythm vary: Piper's `noise_scale` and `noise_w_scale`. */
	expressiveness: number;
	/** How fast it reads: Piper's `length_scale`, its inverse. */
	speed: number;
}

export const VOICE_GAIN = { min: 0, max: 12, default: 0 };
/** −12 dB, as the phone's (music-player.svelte.ts, a quarter), and deploy/pulse.pa's. */
export const MUSIC_DUCK = { min: -30, max: -6, default: -12 };
/**
 * Over 150 % Piper's voices start to sound broken; under 50 %, flat. By default a little livelier
 * and slower than its own (100 %), chosen on 2026-10-27 as a start, not by ear.
 */
export const EXPRESSIVENESS = { min: 50, max: 150, default: 120 };
export const SPEED = { min: 70, max: 130, default: 95 };
/** Piper reading its own way. */
const OWN = 100;

/** Piper's own (its voices' configs), at 100 %. */
const PIPER_NOISE = 0.667;
const PIPER_NOISE_W = 0.8;

/** As Piper's HTTP server takes them (`/synthesize`); nothing when they are its own. */
export function piperStyle({
	expressiveness,
	speed
}: Pick<VoiceLevels, 'expressiveness' | 'speed'>) {
	return {
		...(expressiveness !== OWN && {
			noise_scale: +((PIPER_NOISE * expressiveness) / OWN).toFixed(3),
			noise_w_scale: +((PIPER_NOISE_W * expressiveness) / OWN).toFixed(3)
		}),
		...(speed !== OWN && { length_scale: +(OWN / speed).toFixed(3) })
	};
}

const within = (value: unknown, range: { min: number; max: number; default: number }) => {
	const n = typeof value === 'string' && value.trim() ? Number(value) : value;
	return typeof n === 'number' && Number.isFinite(n)
		? Math.round(Math.min(range.max, Math.max(range.min, n)))
		: range.default;
};

/** Saved or sent ones, within their ranges; the default for each one missing. */
export function parseVoiceLevels(value: unknown): VoiceLevels {
	const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
	return {
		gainDb: within(v.gainDb, VOICE_GAIN),
		duckDb: within(v.duckDb, MUSIC_DUCK),
		expressiveness: within(v.expressiveness, EXPRESSIVENESS),
		speed: within(v.speed, SPEED)
	};
}
