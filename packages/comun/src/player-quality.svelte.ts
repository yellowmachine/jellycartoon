/**
 * The quality of the episodes in this device's player: «auto», the best the connection allows
 * (hls.js chooses), or «light», the 720p version where there is one (light.ts), so the phone away
 * from home neither stops nor spends its data on 15 Mbps. Remembered per device, as where the
 * music sounds (music-target.svelte.ts).
 */

export type Quality = 'auto' | 'light';

const KEY = 'jellycartoon:video-quality';

function stored(): Quality {
	try {
		return localStorage.getItem(KEY) === 'light' ? 'light' : 'auto';
	} catch {
		return 'auto';
	}
}

class PlayerQuality {
	value = $state<Quality>(typeof window === 'undefined' ? 'auto' : stored());

	set(value: Quality) {
		this.value = value;
		try {
			localStorage.setItem(KEY, value);
		} catch {
			// Private window: it is only forgotten.
		}
	}
}

export const playerQuality = new PlayerQuality();
