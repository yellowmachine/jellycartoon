/**
 * Smart plugs (#396), what the page and the server share: the kinds of thing plugged in, and what
 * the page is told of each plug.
 */

export const PLUG_KINDS = {
	lampara: { label: 'Lámpara', icon: '💡' },
	lavadora: { label: 'Lavadora', icon: '🧺' },
	termo: { label: 'Termo', icon: '🚿' },
	nevera: { label: 'Nevera o congelador', icon: '🧊' },
	tele: { label: 'Tele', icon: '📺' },
	otro: { label: 'Otro aparato', icon: '🔌' }
} as const;

export type PlugKind = keyof typeof PLUG_KINDS;

export const isPlugKind = (value: unknown): value is PlugKind =>
	typeof value === 'string' && Object.hasOwn(PLUG_KINDS, value);

export const MAX_PLUG_NAME = 40;

/** Where a plug connects, with its token: what is pasted into its own page. */
export const PLUG_PATH = '/api/enchufe/';

/** The address for a plug: `wss://` on https, `ws://` on http (a test copy). */
export const plugAddress = (origin: string, token: string) =>
	`${origin.replace(/^http/, 'ws')}${PLUG_PATH}${token}`;

export interface PlugView {
	id: string;
	name: string;
	kind: PlugKind;
	/** Connected to Seilide now. */
	online: boolean;
	/** Never connected yet: still to be set up. */
	waiting: boolean;
	output: boolean | null;
	/** Watts now; null if not connected. */
	power: number | null;
	todayWh: number;
	monthWh: number;
	lastSeenAt: string | null;
	model: string | null;
}

/** Wh as the family reads it: «35 Wh», «1,2 kWh». */
export function energyText(wh: number) {
	if (wh < 1000) return `${Math.round(wh)} Wh`;
	return `${(wh / 1000).toLocaleString('es-ES', { maximumFractionDigits: wh < 10_000 ? 2 : 1 })} kWh`;
}

/** Watts as the family reads them: «5 W», «1850 W». */
export const powerText = (w: number) => `${Math.round(w).toLocaleString('es-ES')} W`;

/** A Shelly a satellite found in the home's network (#396), for «Buscar enchufes». */
export interface FoundPlugView {
	deviceId: string;
	model: string;
	ip: string;
	/** With a password: the satellite cannot set it up. */
	auth: boolean;
	satelliteId: string;
	satelliteName: string;
	/** The family's plug it is already, by its name. */
	added: string | null;
	/** Its outbound WebSocket already points somewhere else. */
	elsewhere: boolean;
}
