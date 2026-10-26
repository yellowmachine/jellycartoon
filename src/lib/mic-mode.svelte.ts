/**
 * How the microphone records on this device (Ajustes): held down while speaking, as WhatsApp's
 * voice notes; a tap to start and another to send, for the kitchen's tablet with busy hands; or a
 * tap to start and it is sent at a silence, as after «hola casita» (#144). In the browser, like the
 * music's quality.
 */

const KEY = 'jellycartoon:mic-mode';

export type MicMode = 'hold' | 'tap' | 'auto';

function stored(): MicMode {
	try {
		const value = localStorage.getItem(KEY);
		return value === 'tap' || value === 'auto' ? value : 'hold';
	} catch {
		return 'hold';
	}
}

class MicModeSetting {
	value = $state<MicMode>(typeof window === 'undefined' ? 'hold' : stored());

	/** A tap starts it: sent with another tap, or (`auto`) at a silence. */
	get tap() {
		return this.value !== 'hold';
	}

	get auto() {
		return this.value === 'auto';
	}

	set(value: MicMode) {
		this.value = value;
		try {
			if (value !== 'hold') localStorage.setItem(KEY, value);
			else localStorage.removeItem(KEY);
		} catch {
			// Private window: it is only forgotten.
		}
	}
}

export const micMode = new MicModeSetting();
