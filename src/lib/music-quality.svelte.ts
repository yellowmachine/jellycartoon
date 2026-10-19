/**
 * How the music sounds on this device (Ajustes): the FLAC as is, or its Opus copy for mobile data
 * (#64), about a fifth of it. In the browser, like the device's name: the phone saves data and the
 * TV does not.
 */

const KEY = 'jellycartoon:music-quality';

export type MusicQuality = 'original' | 'saver';

function stored(): MusicQuality {
	try {
		return localStorage.getItem(KEY) === 'saver' ? 'saver' : 'original';
	} catch {
		return 'original';
	}
}

class MusicQualitySetting {
	value = $state<MusicQuality>(typeof window === 'undefined' ? 'original' : stored());

	set(value: MusicQuality) {
		this.value = value;
		try {
			if (value === 'saver') localStorage.setItem(KEY, value);
			else localStorage.removeItem(KEY);
		} catch {
			// Private window: it is only forgotten.
		}
	}
}

export const musicQuality = new MusicQualitySetting();
