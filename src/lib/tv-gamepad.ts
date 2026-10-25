/**
 * The gamepad as the remote in the TV view (#176): its cross or left stick move between what can
 * be chosen, A is OK, B is Back, Start is Home and Select the microphone. Chromium's spatial
 * navigation only follows real arrow keys, so moving is done here, the same way: to the nearest
 * thing in that direction.
 */

export type Direction = 'up' | 'down' | 'left' | 'right';
export type Press = Direction | 'ok' | 'back' | 'home' | 'mic';

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** What can get the focus and is on the screen. */
function candidates() {
	return [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
		if (el.closest('[inert], [aria-hidden="true"]')) return false;
		const r = el.getBoundingClientRect();
		return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
	});
}

/**
 * The focus to the nearest thing in that direction: ahead of the current one, and as little to its
 * side as possible (counted three times what is ahead, so a row or column is kept). With nothing
 * focused, the page's first.
 */
export function moveFocus(direction: Direction) {
	const all = candidates();
	const current = document.activeElement as HTMLElement | null;
	if (!current || current === document.body || !all.includes(current)) {
		(document.querySelector<HTMLElement>('[data-focus]') ?? all[0])?.focus();
		return;
	}
	const from = current.getBoundingClientRect();
	const cx = from.left + from.width / 2;
	const cy = from.top + from.height / 2;
	let best: HTMLElement | null = null;
	let bestScore = Infinity;
	for (const el of all) {
		if (el === current || el.contains(current) || current.contains(el)) continue;
		const r = el.getBoundingClientRect();
		const x = r.left + r.width / 2;
		const y = r.top + r.height / 2;
		const [ahead, aside] =
			direction === 'right'
				? [r.left - from.right, Math.abs(y - cy)]
				: direction === 'left'
					? [from.left - r.right, Math.abs(y - cy)]
					: direction === 'down'
						? [r.top - from.bottom, Math.abs(x - cx)]
						: [from.top - r.bottom, Math.abs(x - cx)];
		// Overlapping a little still counts as ahead; behind does not.
		if (ahead < -4) continue;
		const score = Math.max(ahead, 0) + aside * 3;
		if (score < bestScore) {
			bestScore = score;
			best = el;
		}
	}
	best?.focus();
}

/** The standard mapping's buttons (https://w3c.github.io/gamepad/#remapping). */
const BUTTONS: [number, Press][] = [
	[12, 'up'],
	[13, 'down'],
	[14, 'left'],
	[15, 'right'],
	[0, 'ok'],
	[1, 'back'],
	[9, 'home'],
	[8, 'mic']
];
/** The left stick past this far is a direction too. */
const STICK = 0.6;
/** Held, a direction repeats: after this long, and then this often. */
const FIRST_REPEAT_MS = 400;
const REPEAT_MS = 130;

/**
 * Watches the first gamepad and calls `press` for each press, repeating held directions. The
 * browser shows a gamepad only after one of its buttons is pressed. Returns how to stop.
 */
export function watchGamepad(press: (what: Press) => void) {
	// What was held at the last look: the start counts as held, so a button still down from the
	// game just left does not press anything here.
	let held: Set<Press> | null = null;
	const since = new Map<Press, number>();
	let frame = requestAnimationFrame(function poll(now) {
		const pad = navigator.getGamepads().find((p) => p?.connected);
		const down = new Set<Press>();
		if (pad) {
			for (const [i, what] of BUTTONS) if (pad.buttons[i]?.pressed) down.add(what);
			const [x = 0, y = 0] = pad.axes;
			if (x > STICK) down.add('right');
			if (x < -STICK) down.add('left');
			if (y > STICK) down.add('down');
			if (y < -STICK) down.add('up');
		}
		for (const what of down) {
			if (!held) break;
			const isDirection = what === 'up' || what === 'down' || what === 'left' || what === 'right';
			if (!held.has(what)) {
				since.set(what, now + FIRST_REPEAT_MS);
				press(what);
			} else if (isDirection && now >= (since.get(what) ?? Infinity)) {
				since.set(what, now + REPEAT_MS);
				press(what);
			}
		}
		held = down;
		frame = requestAnimationFrame(poll);
	});
	return () => cancelAnimationFrame(frame);
}
