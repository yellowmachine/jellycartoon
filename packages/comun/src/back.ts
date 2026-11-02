/**
 * Going back without the browser's buttons: an installed app («standalone» in the manifest) has none,
 * and an iPhone has no back gesture in it either.
 */

/**
 * Escape or Backspace go back, as a TV's «back» (a remote in the living room, which has no
 * browser buttons) or on a PC. Not while typing, or while a dialog, a menu or fullscreen is open:
 * Escape closes those itself. Nor when something else already took the key (`preventDefault`).
 */
export function backKey(e: KeyboardEvent): void {
	if ((e.key !== 'Escape' && e.key !== 'Backspace') || e.defaultPrevented) return;
	const target = e.target as HTMLElement;
	if (target.isContentEditable || target.closest('input, textarea, select')) return;
	if (document.querySelector('dialog[open], :popover-open') || document.fullscreenElement) return;
	e.preventDefault();
	history.back();
}

/**
 * Back to the previous page of the app, or to `home` when there is none: opened from a notice or a
 * link straight on this page, `history.back()` would do nothing (or leave the app). The Navigation
 * API knows; without it (older browsers), the history's length.
 */
export function goBack(home: () => void): void {
	const nav = (window as { navigation?: { canGoBack: boolean } }).navigation;
	if (nav ? nav.canGoBack : history.length > 1) history.back();
	else home();
}
