/**
 * Which button of the gamepad does which of the console's (#176), per person and console. In
 * EmulatorJS' terms: each of the console's buttons (RetroArch's numbers, as its control settings
 * use them) to a button of the standard gamepad, by its name there (`BUTTON_1`…). The cross and
 * the sticks are left as they are.
 */

/** The gamepad's buttons that can be given another of the console's, where the drawing has them. */
export const PAD_BUTTONS = [
	{ name: 'BUTTON_1', label: 'A', x: 500, y: 232, kind: 'face' },
	{ name: 'BUTTON_2', label: 'B', x: 544, y: 188, kind: 'face' },
	{ name: 'BUTTON_3', label: 'X', x: 456, y: 188, kind: 'face' },
	{ name: 'BUTTON_4', label: 'Y', x: 500, y: 144, kind: 'face' },
	{ name: 'LEFT_TOP_SHOULDER', label: 'LB', x: 160, y: 74, kind: 'shoulder' },
	{ name: 'RIGHT_TOP_SHOULDER', label: 'RB', x: 480, y: 74, kind: 'shoulder' },
	{ name: 'LEFT_BOTTOM_SHOULDER', label: 'LT', x: 160, y: 28, kind: 'shoulder' },
	{ name: 'RIGHT_BOTTOM_SHOULDER', label: 'RT', x: 480, y: 28, kind: 'shoulder' },
	{ name: 'SELECT', label: 'Select', x: 258, y: 178, kind: 'small' },
	{ name: 'START', label: 'Start', x: 352, y: 178, kind: 'small' }
] as const;

export type PadButton = (typeof PAD_BUTTONS)[number]['name'];
const PAD_NAMES = new Set<string>(PAD_BUTTONS.map((b) => b.name));

/** One of the console's buttons: its number, a short name for the drawing and its whole name. */
export type ConsoleButton = { id: number; short: string; label: string };

const START = { id: 3, short: 'Start', label: 'Start' };
const SELECT = { id: 2, short: 'Select', label: 'Select' };

/** Each EmulatorJS system's buttons, as its control settings list them. */
const CONSOLE_BUTTONS: Record<string, ConsoleButton[]> = {
	nes: [{ id: 8, short: 'A', label: 'A' }, { id: 0, short: 'B', label: 'B' }, SELECT, START],
	gb: [{ id: 8, short: 'A', label: 'A' }, { id: 0, short: 'B', label: 'B' }, SELECT, START],
	snes: [
		{ id: 8, short: 'A', label: 'A' },
		{ id: 0, short: 'B', label: 'B' },
		{ id: 9, short: 'X', label: 'X' },
		{ id: 1, short: 'Y', label: 'Y' },
		{ id: 10, short: 'L', label: 'L' },
		{ id: 11, short: 'R', label: 'R' },
		SELECT,
		START
	],
	gba: [
		{ id: 8, short: 'A', label: 'A' },
		{ id: 0, short: 'B', label: 'B' },
		{ id: 10, short: 'L', label: 'L' },
		{ id: 11, short: 'R', label: 'R' },
		SELECT,
		START
	],
	segaMS: [
		{ id: 0, short: '1', label: 'Botón 1 (también Start)' },
		{ id: 8, short: '2', label: 'Botón 2' }
	],
	segaMD: [
		{ id: 1, short: 'A', label: 'A' },
		{ id: 0, short: 'B', label: 'B' },
		{ id: 8, short: 'C', label: 'C' },
		{ id: 10, short: 'X', label: 'X' },
		{ id: 9, short: 'Y', label: 'Y' },
		{ id: 11, short: 'Z', label: 'Z' },
		{ id: 2, short: 'Mode', label: 'Mode' },
		START
	],
	// FinalBurn Neo: each game uses them its own way, in this order.
	arcade: [
		{ id: 0, short: '1', label: 'Botón 1' },
		{ id: 8, short: '2', label: 'Botón 2' },
		{ id: 1, short: '3', label: 'Botón 3' },
		{ id: 9, short: '4', label: 'Botón 4' },
		{ id: 10, short: '5', label: 'Botón 5' },
		{ id: 11, short: '6', label: 'Botón 6' },
		{ id: 2, short: 'Moneda', label: 'Moneda' },
		START
	]
};

/** EmulatorJS' own, for who has not changed them. */
const DEFAULTS: Record<number, PadButton> = {
	0: 'BUTTON_2',
	1: 'BUTTON_4',
	2: 'SELECT',
	3: 'START',
	8: 'BUTTON_1',
	9: 'BUTTON_3',
	10: 'LEFT_TOP_SHOULDER',
	11: 'RIGHT_TOP_SHOULDER'
};

/** Each of the console's buttons (by its number) to the gamepad's that does it. */
export type Controls = Record<string, PadButton>;

export const consoleButtons = (core: string) => CONSOLE_BUTTONS[core] ?? [];

/** A console's controls: the saved ones over EmulatorJS' own. */
export function controlsFor(core: string, saved: Record<string, string> | null = null): Controls {
	const controls: Controls = {};
	for (const { id } of consoleButtons(core)) {
		const name = saved?.[id];
		controls[id] = name && PAD_NAMES.has(name) ? (name as PadButton) : DEFAULTS[id];
	}
	return controls;
}

/**
 * The gamepad's `pad` button doing the console's `id` from now on. The one of the gamepad that did
 * it does what `pad` did, so none of the console's is left without a button.
 */
export function assign(controls: Controls, pad: PadButton, id: number): Controls {
	const before = controls[id];
	const next: Controls = { ...controls };
	for (const [other, name] of Object.entries(next)) if (name === pad) next[other] = before;
	next[id] = pad;
	return next;
}

/** Whether these are a console's whole controls, one gamepad button each. */
export function isControls(core: string, value: unknown): value is Controls {
	if (!value || typeof value !== 'object') return false;
	const ids = consoleButtons(core).map((b) => String(b.id));
	const entries = Object.entries(value);
	const names = entries.map(([, name]) => name);
	return (
		entries.length === ids.length &&
		entries.every(([id, name]) => ids.includes(id) && PAD_NAMES.has(name)) &&
		new Set(names).size === names.length
	);
}
