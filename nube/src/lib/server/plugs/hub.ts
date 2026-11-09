import type { KeyPlug } from './plug-key-scope.ts';
import {
	energyRise,
	hourOf,
	parseMessage,
	request,
	SWITCH_ID,
	timerOf,
	type SwitchState
} from './shelly.ts';

/**
 * The plugs connected right now (#396), each by its own outbound WebSocket: who it is (its token),
 * what it says, and the orders Seilide sends it on the same connection. SvelteKit has no WebSocket,
 * so the connection is taken by server.js (production) or the Vite plugin (development), which hand
 * it here through `globalThis[Symbol.for('seilide.enchufes')]` (hooks.server.ts).
 *
 * Kept in memory: Seilide is one process. Watts change by the second, so they are only told to the
 * open pages; on or off, the energy counter (every minute) and when it was last heard, saved.
 */

/** What of a `ws` WebSocket is used here: a fake one in the tests. */
export interface PlugSocket {
	send(data: string): void;
	close(code?: number, reason?: string): void;
	terminate(): void;
	ping(): void;
	on(event: 'message', listener: (data: unknown) => void): unknown;
	on(event: 'close' | 'pong', listener: () => void): unknown;
}

/** What a plug is now, for its page. */
export interface PlugLive {
	online: boolean;
	output: boolean | null;
	power: number | null;
	/** When its timer switches it back, in ms (Switch.Set's toggle_after); null, none. */
	timerUntil: number | null;
}

export interface HubDeps {
	plugOfToken(token: string): Promise<KeyPlug | null>;
	/** Saved on the plug, with when it was heard. */
	save(
		familyId: string,
		plugId: string,
		patch: SwitchState & { deviceId?: string; model?: string }
	): Promise<void>;
	/** What it used in that hour, added. */
	addEnergy(familyId: string, plugId: string, hour: Date, wh: number): Promise<void>;
	/** Just connected: its schedules and the rest put right (plugs.ts). */
	onConnect?(familyId: string, plugId: string): void;
	/** Each reading of its, and when its connection is gone: for its notices (watch.ts). */
	onLive?(familyId: string, plugId: string, live: PlugLive): void;
	onGone?(familyId: string, plugId: string): void;
	now?: () => Date;
	log?: (message: string, error?: unknown) => void;
}

export class PlugOffline extends Error {
	constructor() {
		super('El enchufe no está conectado');
	}
}

/** An order unanswered by then: given up. */
const CALL_TIMEOUT_MS = 5000;
/** A connection that does not answer a ping in this long is dropped. */
export const PING_MS = 30_000;
/** The open pages are told at most this often: the watts change by the second. */
const TELL_MS = 1000;
/**
 * After Seilide starts (a new version), the plugs come back by themselves, each at its own pace:
 * seconds, or several minutes (2026-11-09). Until then, or this long, «reconectando», not «sin
 * conexión».
 */
export const RECONNECT_MS = 15 * 60_000;
/** With nothing changed, when it was last heard is saved at most this often. */
export const SEEN_MS = 10 * 60_000;

/** Closing codes (4000–4999, the application's): the plug only tries again. */
const UNKNOWN_TOKEN = 4401;
const REPLACED = 4000;
const REMOVED = 4410;

interface Connection {
	ws: PlugSocket;
	plug: KeyPlug;
	energyWh: number | null;
	nextId: number;
	pending: Map<
		number,
		{
			resolve: (v: unknown) => void;
			reject: (e: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>;
	alive: boolean;
	/** When something of it was last saved (ms). */
	savedAt: number;
}

export function createHub(deps: HubDeps) {
	const now = deps.now ?? (() => new Date());
	const log = deps.log ?? ((m, e) => console.error(`[enchufes] ${m}`, e ?? ''));
	const connections = new Map<string, Connection>();
	const live = new Map<string, PlugLive>();
	const listeners = new Map<string, Set<() => void>>();
	const telling = new Map<string, ReturnType<typeof setTimeout>>();
	const startedAt = now().getTime();

	function tell(familyId: string) {
		if (telling.has(familyId)) return;
		telling.set(
			familyId,
			setTimeout(() => {
				telling.delete(familyId);
				for (const listener of listeners.get(familyId) ?? []) listener();
			}, TELL_MS)
		);
	}

	function liveOf(plugId: string): PlugLive {
		return live.get(plugId) ?? { online: false, output: null, power: null, timerUntil: null };
	}

	/**
	 * What it said: the open pages told only if something they show changed, and saved only what
	 * changed (on or off, energy used), so that an idle plug costs almost nothing. When it was last
	 * heard is saved at most every SEEN_MS: its connection is what says it is there.
	 */
	async function onStatus(c: Connection, sw: SwitchState, full: boolean) {
		const before = liveOf(c.plug.id);
		const switched = sw.output !== undefined && sw.output !== before.output;
		const after: PlugLive = {
			online: true,
			output: sw.output ?? before.output,
			power: sw.power ?? before.power,
			// The whole state says all its timer; a change only when it starts one, so a switch
			// without one is asked (it may have ended or been cancelled).
			timerUntil: sw.timerUntil ?? (full ? null : before.timerUntil)
		};
		live.set(c.plug.id, after);
		if (switched && !full && sw.timerUntil === undefined) void readTimer(c.plug.id);
		deps.onLive?.(c.plug.familyId, c.plug.id, after);

		const patch: SwitchState = {};
		if (sw.output !== undefined && (full || sw.output !== before.output)) {
			patch.output = sw.output;
			patch.power = after.power ?? undefined;
		}
		let rise = 0;
		if (sw.energyWh !== undefined && (full || sw.energyWh !== c.energyWh)) {
			rise = energyRise(c.energyWh, sw.energyWh);
			c.energyWh = sw.energyWh;
			patch.energyWh = sw.energyWh;
			patch.power = after.power ?? undefined;
		}

		if (
			after.output !== before.output ||
			after.power !== before.power ||
			after.timerUntil !== before.timerUntil ||
			rise > 0
		)
			tell(c.plug.familyId);
		if (rise > 0) await deps.addEnergy(c.plug.familyId, c.plug.id, hourOf(now()), rise);
		const at = now().getTime();
		if (!Object.keys(patch).length && at - c.savedAt < SEEN_MS) return;
		c.savedAt = at;
		await deps.save(c.plug.familyId, c.plug.id, patch);
	}

	function onMessage(c: Connection, text: string) {
		const message = parseMessage(text);
		if (!message) return;
		if (message.kind === 'reply') {
			const waiting = c.pending.get(message.id);
			if (!waiting) return;
			c.pending.delete(message.id);
			clearTimeout(waiting.timer);
			if (message.error) waiting.reject(new Error(message.error.message));
			else waiting.resolve(message.result);
			return;
		}
		if (message.sw)
			onStatus(c, message.sw, message.full).catch((e) => log(`${c.plug.id}: no guardado`, e));
	}

	function forget(c: Connection) {
		for (const { reject, timer } of c.pending.values()) {
			clearTimeout(timer);
			reject(new PlugOffline());
		}
		c.pending.clear();
		if (connections.get(c.plug.id) !== c) return;
		connections.delete(c.plug.id);
		live.set(c.plug.id, { ...liveOf(c.plug.id), online: false, power: null, timerUntil: null });
		tell(c.plug.familyId);
		deps.onGone?.(c.plug.familyId, c.plug.id);
	}

	/** Its timer, asked to the plug (Switch.GetStatus): after a switch, which may start or end one. */
	async function readTimer(plugId: string) {
		const c = connections.get(plugId);
		if (!c) return;
		try {
			const timerUntil = timerOf(await call(plugId, 'Switch.GetStatus', { id: SWITCH_ID }));
			const before = liveOf(plugId);
			if (connections.get(plugId) !== c || before.timerUntil === timerUntil) return;
			live.set(plugId, { ...before, timerUntil });
			tell(c.plug.familyId);
		} catch {
			// Gone, or it did not answer: the next whole state says it.
		}
	}

	/** An order to a connected plug: its answer, or PlugOffline, or its error. */
	function call(plugId: string, method: string, params?: Record<string, unknown>) {
		const c = connections.get(plugId);
		if (!c) return Promise.reject(new PlugOffline());
		const id = c.nextId++;
		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				c.pending.delete(id);
				reject(new PlugOffline());
			}, CALL_TIMEOUT_MS);
			c.pending.set(id, { resolve, reject, timer });
			c.ws.send(request(id, method, params));
		});
	}

	/**
	 * A plug that has just connected, with the token from its address. What it says while its token
	 * is looked up (its whole state comes at once) is kept and read after.
	 */
	async function attach(token: string, ws: PlugSocket) {
		const early: string[] = [];
		let c: Connection | null = null;
		let closed = false;
		ws.on('message', (data) => (c ? onMessage(c, String(data)) : early.push(String(data))));
		ws.on('close', () => {
			closed = true;
			if (c) forget(c);
		});
		ws.on('pong', () => {
			if (c) c.alive = true;
		});

		let plug: KeyPlug | null;
		try {
			plug = await deps.plugOfToken(token);
		} catch (e) {
			log('no se pudo buscar el token', e);
			plug = null;
		}
		if (closed) return;
		if (!plug) return ws.close(UNKNOWN_TOKEN, 'Enchufe desconocido');

		connections.get(plug.id)?.ws.close(REPLACED, 'Otra conexión');
		c = {
			ws,
			plug,
			energyWh: plug.energyWh,
			nextId: 1,
			pending: new Map(),
			alive: true,
			savedAt: 0
		};
		connections.set(plug.id, c);
		live.set(plug.id, { ...liveOf(plug.id), online: true });
		tell(plug.familyId);
		for (const text of early) onMessage(c, text);
		deps.onConnect?.(plug.familyId, plug.id);

		call(plug.id, 'Shelly.GetDeviceInfo')
			.then((info) => {
				const { id, model } = (info ?? {}) as { id?: unknown; model?: unknown };
				if (typeof id !== 'string' || typeof model !== 'string') return;
				return deps.save(plug.familyId, plug.id, { deviceId: id, model });
			})
			.catch((e) => {
				if (!(e instanceof PlugOffline)) log(`${plug.id}: sin datos del aparato`, e);
			});
	}

	/** Every connection pinged; one that did not answer the last ping, dropped. */
	function checkAlive() {
		for (const c of connections.values()) {
			if (!c.alive) {
				c.ws.terminate();
				forget(c);
				continue;
			}
			c.alive = false;
			c.ws.ping();
		}
	}

	/**
	 * Removed from the family: told to stop connecting (its outbound WebSocket off, which needs a
	 * restart) if it is connected, then dropped. Not connected, it will keep trying, refused.
	 */
	async function remove(plugId: string) {
		const c = connections.get(plugId);
		if (!c) return;
		try {
			await call(plugId, 'Ws.SetConfig', { config: { enable: false } });
			await call(plugId, 'Shelly.Reboot');
		} catch {
			// Gone already, or it would not: it is refused when it comes back.
		}
		c.ws.close(REMOVED, 'Quitado');
		forget(c);
	}

	return {
		attach,
		call,
		remove,
		liveOf,
		readTimer,
		checkAlive,
		/** The family's open pages, told when any of its plugs changes. */
		watch(familyId: string, listener: () => void) {
			const set = listeners.get(familyId) ?? new Set();
			set.add(listener);
			listeners.set(familyId, set);
			return () => void set.delete(listener);
		},
		/**
		 * Something the pages show changed in Seilide, not in the plug (a schedule, its name, the
		 * pause): told as its own changes, so that an open page, here or on another device, sees it.
		 */
		changed: (familyId: string) => tell(familyId),
		connected: (plugId: string) => connections.has(plugId),
		/**
		 * Not back yet since Seilide started, and not long ago: still coming back after a new version.
		 * One that came back and dropped again, no.
		 */
		reconnecting: (plugId: string) =>
			!live.has(plugId) && now().getTime() - startedAt < RECONNECT_MS
	};
}

export type Hub = ReturnType<typeof createHub>;
