import { music } from 'comun/music-player.svelte.ts';
import { Timers } from 'comun/timers.svelte.ts';
import { videoHere } from '#lib/video-here.svelte.ts';

/**
 * This browser's timers, set by voice (comun/timers.svelte.ts): when one rings, the music and the
 * video here (the news) pause.
 */
export const timers = new Timers({
	pause() {
		music.pauseForVoice();
		videoHere.pauseForVoice();
	},
	resume() {
		music.resumeAfterVoice();
		videoHere.resumeAfterVoice();
	}
});
