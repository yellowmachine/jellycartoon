/**
 * The hint over the microphone in Hablar («Mantén pulsado y habla»), as jellycartoon's: closed
 * with its ×, it stays closed on this device. In the browser, like the microphone's mode.
 */

const KEY = 'nube:voice-hint-closed';

function stored(): boolean {
	try {
		return localStorage.getItem(KEY) === '1';
	} catch {
		return false;
	}
}

class VoiceHintSetting {
	closed = $state(typeof window === 'undefined' ? false : stored());

	close() {
		this.closed = true;
		try {
			localStorage.setItem(KEY, '1');
		} catch {
			// Private window: it is only forgotten.
		}
	}
}

export const voiceHint = new VoiceHintSetting();
