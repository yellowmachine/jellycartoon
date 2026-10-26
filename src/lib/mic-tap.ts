import { micMode } from '#lib/mic-mode.svelte.ts';
import { voice } from '#lib/voice-client.svelte.ts';
import { wakeWord } from '#lib/wake-word.svelte.ts';

/**
 * A tap on the microphone, with taps in Ajustes: to start and another to send, or (`auto`) to
 * start and it is sent at a silence, as after «hola casita» (#144); a tap then sends it at once.
 */
export function tapMic() {
	if (micMode.auto) void wakeWord.listenOnce();
	else voice.toggle();
}
