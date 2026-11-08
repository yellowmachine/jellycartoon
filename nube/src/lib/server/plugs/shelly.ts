/**
 * What Seilide says to a Shelly Gen2+ plug and understands of it (#396), over its outbound
 * WebSocket: JSON-RPC 2.0 frames, as https://shelly-api-docs.shelly.cloud/gen2/General/RPCProtocol.
 * Tried on a Plug M Gen3 (firmware 1.8.99): it sends its whole state on connecting
 * (`NotifyFullStatus`), what changes as it changes (`NotifyStatus`: on or off at once, the watts
 * within a second) and its energy counter every minute on the minute.
 */

/** How Seilide signs its requests: the plug answers to it (`dst`). */
export const SEILIDE_SRC = 'seilide';

/** Its only switch: plugs have one (`switch:0`). */
export const SWITCH_ID = 0;

export interface SwitchState {
	output?: boolean;
	/** Watts now. */
	power?: number;
	/** Its energy counter, in Wh. */
	energyWh?: number;
	/** When its timer (Switch.Set's toggle_after) switches it back, in ms; only when it says one. */
	timerUntil?: number;
}

/**
 * When the timer of a switch's status ends, in ms; null without one. The plug gives
 * `timer_started_at` (seconds) and `timer_duration` only while one runs.
 */
export function timerOf(sw: unknown): number | null {
	const { timer_started_at: at, timer_duration: long } = (sw ?? {}) as Record<string, unknown>;
	return typeof at === 'number' && typeof long === 'number' && Number.isFinite(at + long)
		? Math.round((at + long) * 1000)
		: null;
}

export type ShellyMessage =
	| { kind: 'reply'; id: number; result?: unknown; error?: { code: number; message: string } }
	| { kind: 'status'; src: string | null; full: boolean; sw: SwitchState | null };

export function request(id: number, method: string, params?: Record<string, unknown>) {
	return JSON.stringify({ jsonrpc: '2.0', id, src: SEILIDE_SRC, method, params });
}

/** What its `switch:0` says, of what Seilide keeps; null if it says nothing of it. */
export function switchOf(params: unknown): SwitchState | null {
	const sw = (params as Record<string, unknown> | null)?.[`switch:${SWITCH_ID}`];
	if (!sw || typeof sw !== 'object') return null;
	const { output, apower, aenergy } = sw as {
		output?: unknown;
		apower?: unknown;
		aenergy?: { total?: unknown };
	};
	const state: SwitchState = {};
	if (typeof output === 'boolean') state.output = output;
	if (typeof apower === 'number' && Number.isFinite(apower)) state.power = apower;
	if (typeof aenergy?.total === 'number' && Number.isFinite(aenergy.total))
		state.energyWh = aenergy.total;
	const timer = timerOf(sw);
	if (timer !== null) state.timerUntil = timer;
	return Object.keys(state).length ? state : null;
}

/** A frame from the plug, or null if it is not one Seilide understands. */
export function parseMessage(text: string): ShellyMessage | null {
	let frame: Record<string, unknown>;
	try {
		frame = JSON.parse(text);
	} catch {
		return null;
	}
	if (!frame || typeof frame !== 'object') return null;
	if (typeof frame.id === 'number' && !('method' in frame))
		return {
			kind: 'reply',
			id: frame.id,
			result: frame.result,
			error: frame.error as { code: number; message: string } | undefined
		};
	if (frame.method === 'NotifyStatus' || frame.method === 'NotifyFullStatus')
		return {
			kind: 'status',
			src: typeof frame.src === 'string' ? frame.src : null,
			full: frame.method === 'NotifyFullStatus',
			sw: switchOf(frame.params)
		};
	return null;
}

/**
 * What was used since the counter was last seen, in Wh. The first time, nothing: only where it
 * stands. Lower than before, it started again from zero (reset), so all it says now is new.
 */
export function energyRise(before: number | null, now: number) {
	if (before === null) return 0;
	return now >= before ? now - before : now;
}

/** The hour a moment falls in, by its start: what each hour used is kept by it. */
export function hourOf(moment: Date) {
	const hour = new Date(moment);
	hour.setUTCMinutes(0, 0, 0);
	return hour;
}
