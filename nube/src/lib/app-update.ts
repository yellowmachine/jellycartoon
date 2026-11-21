/**
 * When a new version of the app (#579) takes over by itself, never asked: pure, for the tests.
 * app-update.svelte.ts does it; the layout asks, by the mode it is in:
 * - the Vista, untouched a while and quiet (vista-idle.ts, shouldUpdateVista);
 * - the road mode, only on leaving it;
 * - anywhere else, on the next navigation: a whole page load instead of the app's own change of
 *   page, which nobody tells apart, and nothing half typed is lost, as the page was being left.
 */

const under = (path: string, section: string) => path === section || path.startsWith(`${section}/`);

export interface NavigationState {
	/** The page being left, and the one going to. */
	from: string;
	to: string;
	/** The Vista's screen is on (its own pages, without the site around). */
	vistaShown: boolean;
	/** Whether a page belongs to the Vista (vista.svelte.ts, inVista). */
	inVista: (path: string) => boolean;
	/**
	 * Something a load would cut: music, the radio or a podcast playing, a walk being recorded, the
	 * voice listening or answering, a timer ringing.
	 */
	busy: boolean;
}

/** On this navigation, the new version: a whole load to `to`. */
export function updatesOnNavigation(s: NavigationState) {
	if (s.busy) return false;
	// Inside the Vista, from tab to tab: it waits to be quiet (shouldUpdateVista).
	if (s.vistaShown && s.inVista(s.to)) return false;
	// Inside the road mode (its lists, its album): only leaving it.
	if (under(s.from, '/carretera') && under(s.to, '/carretera')) return false;
	return true;
}

/**
 * Tried and the page still on the old version (the new one did not take over): not again so soon,
 * or every navigation would load the whole page.
 */
export const RETRY_MS = 30 * 60_000;

export const mayTry = (lastTry: number | null, now: number) =>
	lastTry === null || now - lastTry >= RETRY_MS;
