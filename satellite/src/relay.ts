import { WebSocket, WebSocketServer } from 'ws';
import { isHomeIp, RELAY_PATH, RELAY_PORT } from './plugs.ts';

/**
 * The plugs through the satellite (#643, phase 1): each Shelly's outbound WebSocket points here, in
 * the home's network, and the satellite opens one to Seilide for it. What the plug says goes up as
 * it is; what Seilide asks of the plug goes down only if it is in the list below. So a Seilide that
 * is broken into can switch plugs on and off, but never put a script on them, change their
 * configuration or point them at another server.
 *
 * Shelly asks no password on its outbound WebSocket (Authentication, «all communication is
 * protected except: … Outbound Websocket»): this list is what guards it.
 */

/** Its only switch (`switch:0`), as Seilide's shelly.ts. */
const SWITCH_ID = 0;
/** Longest timer Seilide sets (Switch.Set's toggle_after): a day. */
const MAX_TOGGLE_S = 86_400;
/** A plug's frames are small (its whole state, about 1.5 KB). */
const MAX_PAYLOAD = 64 * 1024;
/** A plug that does not answer a ping in this long is dropped: Seilide must not see it online. */
const PING_MS = 30_000;

type Params = Record<string, unknown>;

const isObject = (v: unknown): v is Params =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** Only those keys, if any. */
const onlyKeys = (v: Params, keys: string[]) => Object.keys(v).every((k) => keys.includes(k));

function switchSet(p: unknown) {
	if (!isObject(p) || !onlyKeys(p, ['id', 'on', 'toggle_after'])) return false;
	if (p.id !== SWITCH_ID || typeof p.on !== 'boolean') return false;
	if (p.toggle_after === undefined) return true;
	const s = p.toggle_after;
	return typeof s === 'number' && Number.isFinite(s) && s > 0 && s <= MAX_TOGGLE_S;
}

/** Only reading: whatever it is asked. */
const READ = new Set([
	'Shelly.GetDeviceInfo',
	'Wifi.GetStatus',
	'Switch.GetStatus',
	'Sys.GetConfig',
	'Schedule.List'
]);

/** What else Seilide may ask, each with exactly the parameters it uses (plugs.ts, hub.ts). */
const CHANGE: Record<string, (p: unknown) => boolean> = {
	'Switch.Set': switchSet,
	// Its time zone, for its schedules: nothing else of its configuration.
	'Sys.SetConfig': (p) =>
		isObject(p) &&
		onlyKeys(p, ['config']) &&
		isObject(p.config) &&
		onlyKeys(p.config, ['location']) &&
		isObject(p.config.location) &&
		onlyKeys(p.config.location, ['tz']) &&
		typeof p.config.location.tz === 'string' &&
		p.config.location.tz.length <= 64,
	// A schedule may call any method: only Switch.Set.
	'Schedule.Create': (p) =>
		isObject(p) &&
		onlyKeys(p, ['enable', 'timespec', 'calls']) &&
		(p.enable === undefined || typeof p.enable === 'boolean') &&
		typeof p.timespec === 'string' &&
		p.timespec.length <= 100 &&
		Array.isArray(p.calls) &&
		p.calls.length >= 1 &&
		p.calls.length <= 5 &&
		p.calls.every(
			(c) =>
				isObject(c) &&
				onlyKeys(c, ['method', 'params']) &&
				c.method === 'Switch.Set' &&
				switchSet(c.params)
		),
	'Schedule.Delete': (p) => isObject(p) && onlyKeys(p, ['id']) && Number.isInteger(p.id),
	// Removed from the family: it stops connecting. Never another server.
	'Ws.SetConfig': (p) =>
		isObject(p) &&
		onlyKeys(p, ['config']) &&
		isObject(p.config) &&
		onlyKeys(p.config, ['enable']) &&
		p.config.enable === false,
	'Shelly.Reboot': (p) => p === undefined || (isObject(p) && Object.keys(p).length === 0)
};

export type Verdict =
	{ ok: true } | { ok: false; id: number | null; src: string | null; why: string };

/** Whether a frame from Seilide may go down to the plug. */
export function check(text: string): Verdict {
	let frame: unknown;
	try {
		frame = JSON.parse(text);
	} catch {
		return { ok: false, id: null, src: null, why: 'no es JSON' };
	}
	if (!isObject(frame)) return { ok: false, id: null, src: null, why: 'no es una petición' };
	const id = typeof frame.id === 'number' ? frame.id : null;
	const src = typeof frame.src === 'string' ? frame.src : null;
	const method = frame.method;
	if (id === null || typeof method !== 'string')
		return { ok: false, id, src, why: 'no es una petición' };
	if (!onlyKeys(frame, ['jsonrpc', 'id', 'src', 'method', 'params']))
		return { ok: false, id, src, why: `${method} con algo de más` };
	if (READ.has(method)) return { ok: true };
	const allowed = CHANGE[method];
	if (!allowed) return { ok: false, id, src, why: `${method} no está permitido` };
	if (!allowed(frame.params)) return { ok: false, id, src, why: `${method} con esos datos, no` };
	return { ok: true };
}

/** The answer to Seilide for a refused order, as the plug's own errors, so it is not waited for. */
export const refusal = (id: number, dst: string | null, why: string) =>
	JSON.stringify({
		id,
		src: 'satelite',
		...(dst ? { dst } : {}),
		error: { code: 403, message: `El satélite no lo deja: ${why}` }
	});

export interface RelayOptions {
	port?: number;
	/** Seilide's `ws(s)://…/api/enchufe/`: the only place a plug's connection goes up to. */
	upstream: string;
	/** The satellite's key: Seilide knows the plug comes through it. */
	key: string;
	log: (message: string) => void;
	/** Who may connect: the home's network (a test, also its own machine). */
	fromHome?: (ip: string) => boolean;
}

/** The plugs' WebSocket, here; closed with `close()`. */
export function startRelay({
	port = RELAY_PORT,
	upstream,
	key,
	log,
	fromHome = isHomeIp
}: RelayOptions) {
	const server = new WebSocketServer({ port, maxPayload: MAX_PAYLOAD });
	server.on('error', (err) => log(`Enchufes, sin puerto ${port}: ${err.message}`));

	server.on('connection', (plug, req) => {
		const from = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
		const token = req.url?.match(RELAY_PATH)?.[1];
		if (!fromHome(from) || !token) return plug.close(1008, 'No');

		const up = new WebSocket(`${upstream}${token}`, {
			headers: { 'x-api-key': key },
			maxPayload: MAX_PAYLOAD
		});
		const early: string[] = [];
		let alive = true;
		const pinger = setInterval(() => {
			if (!alive) return plug.terminate();
			alive = false;
			plug.ping();
		}, PING_MS);
		const end = () => {
			clearInterval(pinger);
			if (plug.readyState === WebSocket.OPEN) plug.close();
			if (up.readyState === WebSocket.OPEN || up.readyState === WebSocket.CONNECTING)
				up.terminate();
		};

		plug.on('pong', () => (alive = true));
		plug.on('message', (data) => {
			const text = String(data);
			if (up.readyState === WebSocket.OPEN) up.send(text);
			else early.push(text);
		});
		up.on('open', () => {
			for (const text of early.splice(0)) up.send(text);
		});
		up.on('message', (data) => {
			const text = String(data);
			const verdict = check(text);
			if (verdict.ok) return plug.send(text);
			log(`Enchufe ${from}: ${verdict.why}`);
			if (verdict.id !== null) up.send(refusal(verdict.id, verdict.src, verdict.why));
		});
		plug.on('close', end);
		up.on('close', end);
		plug.on('error', end);
		up.on('error', (err) => {
			log(`Enchufe ${from}, sin Seilide: ${err.message}`);
			end();
		});
	});

	return { close: () => server.close() };
}
