/**
 * What a plug's watts say (#396, phase 3), as they arrive (hub.ts): a washing machine has finished,
 * a fridge has stopped, it has gone without connection, or it has been on too long. Only in memory:
 * after a restart it starts counting again. Each notice once, until what it watches starts again.
 */

export interface WatchSettings {
	done: boolean;
	stopped: boolean;
	offline: boolean;
	/** On longer than this many hours; null, never. */
	onHours: number | null;
}

export type WatchEvent = 'done' | 'stopped' | 'offline' | 'longOn';

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
	seen(power: number | null, output: boolean | null, now: number): WatchEvent[] {
		const events: WatchEvent[] = [];
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
			if (now - this.runningSince >= CYCLE_MS) this.cycle = true;
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
	tick(now: number): WatchEvent[] {
		const events: WatchEvent[] = [];
		if (this.offlineSince !== null) {
			if (this.settings.offline && !this.offlineTold && now - this.offlineSince >= OFFLINE_MS) {
				this.offlineTold = true;
				events.push('offline');
			}
			return events;
		}
		if (this.cycle && this.idleSince !== null && now - this.idleSince >= DONE_MS) {
			this.cycle = false;
			this.idleSince = null;
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
