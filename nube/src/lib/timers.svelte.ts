import { music } from 'comun/music-player.svelte.ts';
import { Timers } from 'comun/timers.svelte.ts';
import { kitchenLog } from '#lib/kitchen-log.svelte.ts';
import { pauseVistaVideo, resumeVistaVideo } from '#lib/vista.svelte.ts';
import { recipe } from '#lib/recipe.svelte.ts';

/**
 * The kitchen's timers (#60), in this browser (comun/timers.svelte.ts): when one rings, the music
 * pauses, and the kitchen's video (#483); the recipe being cooked goes on to the step after it, and says it; and it is written in
 * the kitchen's session.
 */
export const timers = new Timers({
	pause: () => {
		music.pauseForVoice();
		pauseVistaVideo();
	},
	resume: () => {
		music.resumeAfterVoice();
		resumeVistaVideo();
	},
	ended: (labels) => recipe.afterTimers(labels),
	said: (text) => kitchenLog.add(null, text)
});
