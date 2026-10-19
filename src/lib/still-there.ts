/**
 * «¿Sigues ahí?» (#77): after some episodes in a row started by themselves («siguiente
 * automático», or mpv's list in the living room) with nobody touching anything, the next one
 * waits for an answer, and without one it stops. Shared by the server and the pages.
 */

/** Episodes started by themselves before asking, as chosen for each child in /infantil. */
export const ASK_EVERY_OPTIONS = [2, 3, 4] as const;
/** For a child without a choice yet, as the column's default. */
export const ASK_EVERY_DEFAULT = 3;
/** Time to answer; then it stops. */
export const ANSWER_SECONDS = 120;

export const QUESTION = '¿Sigues ahí?';
