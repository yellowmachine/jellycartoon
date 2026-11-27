/**
 * What a plug's watts say (#396, phase 3), as they arrive (Seilide's hub.ts; the satellite's relay
 * too, #651, for the rules it keeps): a washing machine has finished,
 * a fridge has stopped, it has gone without connection, or it has been on too long. Only in memory:
 * after a restart it starts counting again. Each notice once, until what it watches starts again.
 * And, for the rules (#528), whatever the notices: a cycle that starts and one that ends.
 */

export interface WatchSettings {
	done: boolean;
	stopped: boolean;
	offline: boolean;
	/** On longer than this many hours; null, never. */
	onHours: number | null;
	/** Without connection this long is «offline»: OFFLINE_MS, unless said (a sensor, #508). */
	offlineMs?: number;
}

export type WatchEvent = 'done' | 'stopped' | 'offline' | 'longOn';
/** For the rules (#528): a cycle (a wash) starts, or it ends; told always. */
export type CycleEvent = 'started' | 'finished';

/** More than this, it is working; less than IDLE_W, it is not. In between, as it was. */
export const RUNNING_W = 10;
export const IDLE_W = 5;
/** Working this long is a cycle (a wash), not a blip. */
export const CYCLE_MS = 5 * 60_000;
/** Idle this long after a cycle: it has finished. */
export const DONE_MS = 3 * 60_000;
/** A fridge stops and starts, but never for this long. */
export const STOPPED_MS = 3 * 3_600_000;
/** Without connection this long: the power or the wifi. */
export const OFFLINE_MS = 30 * 60_000;
/**
 * A sensor (#508) sleeps between readings, so being away is normal: it wakes every 10 minutes on
 * USB and every 2 hours on batteries (wakeup_period 600 and 7200, seen 2026-11-19), or sooner if
 * the temperature or humidity changes. Silent this long (two missed wakes on batteries and some
 * margin), something is wrong.
 */
export const SENSOR_SILENT_MS = 5 * 3_600_000;

export class PlugWatch {
	private runningSince: number | null = null;
	private cycle = false;
	private idleSince: number | null = null;
	private activeAt: number;
	private stoppedTold = false;
	private offlineSince: number | null = null;
	private offlineTold = false;
	private onSince: number | null = null;
	private longOnTold = false;
	/** Switched off on purpose: not «stopped». */
	private output: boolean | null = null;
	private power: number | null = null;

	constructor(
		public settings: WatchSettings,
		now: number
	) {
		this.activeAt = now;
	}

	/** Its watts and whether it is on, as they come. What it says now. */
	seen(power: number | null, output: boolean | null, now: number): (WatchEvent | CycleEvent)[] {
		const events: (WatchEvent | CycleEvent)[] = [];
		this.offlineSince = null;
		this.offlineTold = false;

		if (output !== null) {
			// Back on: the hours without working start now.
			if (output && this.output === false) this.activeAt = now;
			this.output = output;
		}
		if (output === true) this.onSince ??= now;
		else if (output === false) {
			this.onSince = null;
			this.longOnTold = false;
		}

		if (power === null) return events;
		// Working until now: it says so when its watts drop.
		if (power > IDLE_W || (this.power !== null && this.power > IDLE_W)) this.activeAt = now;
		if (power > IDLE_W) this.stoppedTold = false;
		this.power = power;
		if (power > RUNNING_W) {
			this.runningSince ??= now;
			this.idleSince = null;
			if (!this.cycle && now - this.runningSince >= CYCLE_MS) {
				this.cycle = true;
				events.push('started');
			}
		} else if (power < IDLE_W) {
			this.runningSince = null;
			if (this.cycle) this.idleSince ??= now;
		}
		return [...events, ...this.tick(now)];
	}

	/** Gone without connection. */
	gone(now: number) {
		this.offlineSince ??= now;
		this.runningSince = null;
		this.idleSince = null;
		this.cycle = false;
	}

	/** What time alone says: called now and then, and with each reading. */
	tick(now: number): (WatchEvent | CycleEvent)[] {
		const events: (WatchEvent | CycleEvent)[] = [];
		if (this.offlineSince !== null) {
			const long = this.settings.offlineMs ?? OFFLINE_MS;
			if (this.settings.offline && !this.offlineTold && now - this.offlineSince >= long) {
				this.offlineTold = true;
				events.push('offline');
			}
			return events;
		}
		if (this.cycle && this.idleSince !== null && now - this.idleSince >= DONE_MS) {
			this.cycle = false;
			this.idleSince = null;
			events.push('finished');
			if (this.settings.done) events.push('done');
		}
		if (
			this.settings.stopped &&
			this.output !== false &&
			!this.stoppedTold &&
			now - this.activeAt >= STOPPED_MS
		) {
			this.stoppedTold = true;
			events.push('stopped');
		}
		const onHours = this.settings.onHours;
		if (
			onHours !== null &&
			this.onSince !== null &&
			!this.longOnTold &&
			now - this.onSince >= onHours * 3_600_000
		) {
			this.longOnTold = true;
			events.push('longOn');
		}
		return events;
	}
}

/**
 * Its watts and whether it is on, from a Shelly's status frame (`NotifyStatus`,
 * `NotifyFullStatus`): what its `switch:0` says; null if it is not one, or says neither.
 */
export function switchReading(
	text: string
): { power: number | null; output: boolean | null } | null {
	let frame: { method?: unknown; params?: Record<string, unknown> };
	try {
		frame = JSON.parse(text);
	} catch {
		return null;
	}
	if (frame?.method !== 'NotifyStatus' && frame?.method !== 'NotifyFullStatus') return null;
	const sw = frame.params?.['switch:0'] as { apower?: unknown; output?: unknown } | undefined;
	if (!sw || typeof sw !== 'object') return null;
	const power = typeof sw.apower === 'number' && Number.isFinite(sw.apower) ? sw.apower : null;
	const output = typeof sw.output === 'boolean' ? sw.output : null;
	return power === null && output === null ? null : { power, output };
}
