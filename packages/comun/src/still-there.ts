/**
 * «¿Sigues ahí?» (#77): when an episode starts by itself («siguiente automático», or mpv's list in
 * the living room) and nobody has touched anything for a while, it waits for an answer, and
 * without one it stops. By time, not by episodes: 15-minute cartoons and 45-minute series alike.
 * The one on stays on to its end. Shared by the server and the pages.
 */

/** Minutes with nobody touching anything before asking, as chosen in Ajustes and /infantil. */
export const ASK_AFTER_OPTIONS = [60, 90, 120] as const;
/** For a child without a choice yet, as the column's default. */
export const ASK_AFTER_DEFAULT = 90;
/** Time to answer; then it stops. */
export const ANSWER_SECONDS = 120;

export const QUESTION = '¿Sigues ahí?';

/** «1 h», «1 h 30», «2 h». */
export function askAfterLabel(minutes: number) {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return [h ? `${h} h` : '', m ? (h ? String(m) : `${m} min`) : ''].filter(Boolean).join(' ');
}

/** Whether nobody has touched anything for `minutes` since `touchedAt` (ms); null minutes, never. */
export function longUnattended(touchedAt: number, minutes: number | null, now = Date.now()) {
	return minutes !== null && now - touchedAt >= minutes * 60_000;
}
