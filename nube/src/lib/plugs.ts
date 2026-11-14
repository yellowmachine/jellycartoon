import { fold } from 'comun/music.ts';
import type { PlugScheduleView } from './plug-schedules.ts';

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

/** A plug's notices (#396, phase 3). */
export interface PlugNotices {
	/** «Ha terminado»: a cycle over (a washing machine). */
	done: boolean;
	/** «Ha dejado de funcionar»: hours without using anything (a fridge). */
	stopped: boolean;
	/** «Sin conexión»: the power or the wifi gone at home. */
	offline: boolean;
	/** «Lleva encendido más de…» these hours; null, never. */
	onHours: number | null;
	/** Said out loud by the satellites too. */
	aloud: boolean;
}

/** At most this many hours for «Lleva encendido más de…». */
export const MAX_ON_HOURS = 48;

/** Enchufes' timer buttons (#396): «Apagar dentro de» / «Encender durante», in minutes. */
export const TIMER_MINUTES = [15, 30, 60, 120] as const;
export const timerLabel = (minutes: number) =>
	minutes < 60 ? `${minutes} min` : `${minutes / 60} h`;

/** As each kind starts: what is worth knowing about it. */
export function noticeDefaults(kind: PlugKind) {
	return {
		notifyDone: kind === 'lavadora',
		notifyStopped: kind === 'nevera',
		notifyOffline: kind === 'nevera' || kind === 'termo',
		notifyOnHours: null,
		notifyAloud: false
	};
}

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
	/** Not connected, but Seilide has just started (a new version): it is coming back by itself. */
	reconnecting: boolean;
	output: boolean | null;
	/** Watts now; null if not connected. */
	power: number | null;
	todayWh: number;
	monthWh: number;
	/** In euros, each hour at its price (kwh-price.ts); null without a price. */
	todayEuros: number | null;
	monthEuros: number | null;
	lastSeenAt: string | null;
	model: string | null;
	/** Its address in the home's wifi, for a link to its own page: only who runs the family. */
	ip: string | null;
	notices: PlugNotices;
	/** «En pausa» (#396): off, schedules off. */
	paused: boolean;
	/** «Con candado»: not switched, paused nor given schedules from Seilide, against a slip. */
	locked: boolean;
	/** A long heat going on (a water heater after a long pause), until then. */
	heatUntil: string | null;
	/** Its own timer (by voice, «media hora»): when it switches back by itself. */
	timerUntil: string | null;
	schedules: PlugScheduleView[];
}

/** Wh as the family reads it: «35 Wh», «1,2 kWh». */
export function energyText(wh: number) {
	if (wh < 1000) return `${Math.round(wh)} Wh`;
	return `${(wh / 1000).toLocaleString('es-ES', { maximumFractionDigits: wh < 10_000 ? 2 : 1 })} kWh`;
}

/** Watts as the family reads them: «5 W», «1850 W». */
/** Euros as the family reads them: «0,03 €», «12,40 €». */
export const euroText = (euros: number) =>
	euros.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });

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

/** The one meant: its name the same, or the only one whose name has it in it, or the reverse. */
export function plugNamed<P extends { name: string }>(plugs: P[], said: string) {
	const want = fold(said).trim();
	if (!want) return null;
	const same = plugs.filter((p) => fold(p.name).trim() === want);
	if (same.length === 1) return same[0]!;
	const near = plugs.filter((p) => fold(p.name).includes(want) || want.includes(fold(p.name)));
	return near.length === 1 ? near[0]! : null;
}
