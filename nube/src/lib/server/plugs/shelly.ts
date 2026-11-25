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

/**
 * What a temperature and humidity sensor says (#508, Shelly H&T Gen3, firmware 1.4.5 seen on
 * 2026-11-19): `temperature:0` (`tC`), `humidity:0` (`rh`), `devicepower:0` (its battery and
 * whether it is on USB), as https://shelly-api-docs.shelly.cloud/gen2/Devices/Gen3/ShellyHTG3.
 * Only what it said: a change may bring one of them alone. `null`, it could not read it.
 */
export interface SensorReading {
	tempC?: number | null;
	humidity?: number | null;
	battery?: number | null;
	external?: boolean;
}

export type ShellyMessage =
	| { kind: 'reply'; id: number; result?: unknown; error?: { code: number; message: string } }
	| {
			kind: 'status';
			src: string | null;
			full: boolean;
			sw: SwitchState | null;
			sensor: SensorReading | null;
	  };

/**
 * A sensor, not a plug, by its Shelly id: H&T (Gen3 `shellyhtg3-…`, Plus `shellyplusht-…`). It
 * sleeps between readings and has no switch.
 */
export const isSensorDevice = (deviceId: string | null | undefined) =>
	!!deviceId && /^shelly(plus)?ht(g\d+)?-/i.test(deviceId);

const reading = (v: unknown) =>
	v === null ? null : typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** What its temperature, humidity and battery say; null if it says nothing of them. */
export function sensorOf(params: unknown): SensorReading | null {
	const p = (params ?? {}) as Record<string, unknown>;
	const t = p['temperature:0'] as { tC?: unknown } | undefined;
	const h = p['humidity:0'] as { rh?: unknown } | undefined;
	const d = p['devicepower:0'] as
		{ battery?: { percent?: unknown }; external?: { present?: unknown } } | undefined;
	const state: SensorReading = {};
	if (t && typeof t === 'object' && 'tC' in t) {
		const v = reading(t.tC);
		if (v !== undefined) state.tempC = v;
	}
	if (h && typeof h === 'object' && 'rh' in h) {
		const v = reading(h.rh);
		if (v !== undefined) state.humidity = v;
	}
	if (d && typeof d === 'object') {
		const v = reading(d.battery?.percent);
		if (v !== undefined) state.battery = v === null ? null : Math.round(v);
		if (typeof d.external?.present === 'boolean') state.external = d.external.present;
	}
	return Object.keys(state).length ? state : null;
}

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

/**
 * Its IPv4 address in the wifi, from Wifi.GetStatus's `sta_ip`
 * (https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/WiFi#status); null without one.
 */
export function staIpOf(status: unknown): string | null {
	const ip = (status as { sta_ip?: unknown } | null)?.sta_ip;
	if (typeof ip !== 'string') return null;
	const parts = ip.split('.');
	return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
		? ip
		: null;
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
			sw: switchOf(frame.params),
			sensor: sensorOf(frame.params)
		};
	return null;
}

/**
 * What was used since the counter was last seen, in Wh. The first time, nothing: only where it
 * stands. Much lower than before, it started again from zero (reset), so all it says now is new;
 * a little lower is a rounding (kept as a float4, 29150.478 came back as 29150.479, and each
 * reconnection counted the whole counter again), so nothing.
 */
export function energyRise(before: number | null, now: number) {
	if (before === null) return 0;
	if (now >= before) return now - before;
	return now < before / 2 ? now : 0;
}

/** The hour a moment falls in, by its start: what each hour used is kept by it. */
export function hourOf(moment: Date) {
	const hour = new Date(moment);
	hour.setUTCMinutes(0, 0, 0);
	return hour;
}
