/**
 * How the microphone records on this device (Ajustes): held down while speaking, as WhatsApp's
 * voice notes, or a tap to start and another to send, for the kitchen's tablet with busy hands. In
 * the browser, like the music's quality.
 */

const KEY = 'jellycartoon:mic-mode';

export type MicMode = 'hold' | 'tap';

function stored(): MicMode {
	try {
		return localStorage.getItem(KEY) === 'tap' ? 'tap' : 'hold';
	} catch {
		return 'hold';
	}
}

class MicModeSetting {
	value = $state<MicMode>(typeof window === 'undefined' ? 'hold' : stored());

	get tap() {
		return this.value === 'tap';
	}

	set(value: MicMode) {
		this.value = value;
		try {
			if (value === 'tap') localStorage.setItem(KEY, value);
			else localStorage.removeItem(KEY);
		} catch {
			// Private window: it is only forgotten.
		}
	}
}

export const micMode = new MicModeSetting();
