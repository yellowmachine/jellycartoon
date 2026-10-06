export const PLAYER_SIZES = [
	{ value: 'small', label: 'Pequeño' },
	{ value: 'normal', label: 'Normal' },
	{ value: 'cinema', label: 'Cine' }
] as const;

export type PlayerSize = (typeof PLAYER_SIZES)[number]['value'];

const KEY = 'jellycartoon.playerSize';

/**
 * Per device (the right size on a phone isn't the right size on a TV), so it lives in
 * localStorage rather than in the user's settings. Only touched in the browser.
 */
export const playerSize = $state<{ value: PlayerSize }>({ value: 'normal' });

export function loadPlayerSize() {
	try {
		const stored = localStorage.getItem(KEY);
		if (PLAYER_SIZES.some((s) => s.value === stored)) playerSize.value = stored as PlayerSize;
	} catch {
		// Storage unavailable (private mode…): keep the default.
	}
}

export function setPlayerSize(value: PlayerSize) {
	playerSize.value = value;
	try {
		localStorage.setItem(KEY, value);
	} catch {
		// Not persisted; still applies to this page.
	}
}
