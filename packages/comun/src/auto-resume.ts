/**
 * Music that pauses by itself with the phone in the pocket: Chrome pauses it with nobody asking
 * (seen on two walks: the third song paused under a second after it started, with no headphones,
 * nothing touched, and no Media Session action). Played again at once, within the pause itself:
 * paused and with the screen off, Android freezes the page right away, and a timer waiting a
 * moment only ran once the screen was on again (1.28.0). A couple of times in a row at most, so as
 * not to fight a call or another app that keeps the sound.
 */
/** In a row, at most; then it stays paused, as Chrome left it. */
export const MAX_IN_A_ROW = 2;
/** Playing this long since the last one, the count starts again. */
export const FINE_AFTER_MS = 60_000;
/** A pause this soon after someone asked for one (the app, the lock screen) is theirs. */
export const ON_PURPOSE_MS = 1_500;

export interface PauseSeen {
	/** The page out of sight: screen off or another app. */
	hidden: boolean;
	/** At the end of the track: the next one comes by itself. */
	ended: boolean;
	/** Nothing loaded, or a new track loading (changing `src` pauses). */
	loading: boolean;
	/** When someone last asked to pause (ms, as `now`); 0, never. */
	askedAt: number;
	now: number;
	/** Played again by this already, recently. */
	inARow: number;
}

/** Whether this pause is the phone's alone, and is to be undone. */
export function shouldResume(p: PauseSeen) {
	if (!p.hidden || p.ended || p.loading) return false;
	if (p.askedAt && p.now - p.askedAt < ON_PURPOSE_MS) return false;
	return p.inARow < MAX_IN_A_ROW;
}
