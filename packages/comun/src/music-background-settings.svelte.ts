import type { BackgroundStyle } from 'comun/music-background.ts';

/**
 * The Música background on this device (Ajustes): the TV can have a lively one and the phone none.
 * In the browser, like where the music sounds (music-target).
 */

const KEY = 'jellycartoon:music-background';

interface Saved {
	style: BackgroundStyle | 'none';
	/** 0 to 1. */
	intensity: number;
	/** 0 to 1. */
	speed: number;
}

const DEFAULTS: Saved = { style: 'aurora', intensity: 0.6, speed: 0.5 };

function stored(): Saved {
	try {
		return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
	} catch {
		return DEFAULTS;
	}
}

class MusicBackgroundSettings {
	#saved = typeof window === 'undefined' ? DEFAULTS : stored();
	style = $state(this.#saved.style);
	intensity = $state(this.#saved.intensity);
	speed = $state(this.#saved.speed);

	set(values: Partial<Saved>) {
		Object.assign(this, values);
		try {
			localStorage.setItem(
				KEY,
				JSON.stringify({ style: this.style, intensity: this.intensity, speed: this.speed })
			);
		} catch {
			// Private window: it is only forgotten.
		}
	}
}

export const musicBackground = new MusicBackgroundSettings();
