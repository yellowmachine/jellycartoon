import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { isHomeIp, RELAY_PATH, RELAY_PORT } from './plugs.ts';
import type { Trust } from './trust.ts';
import { PlugWatch, switchReading, type CycleEvent } from '../../packages/comun/src/plug-watch.ts';

/**
 * The plugs through the satellite (#643, phase 1): each Shelly's outbound WebSocket points here, in
 * the home's network, and the satellite opens one to Seilide for it. What the plug says goes up as
 * it is; what Seilide asks of the plug goes down only if it is in the list below. So a Seilide that
 * is broken into can switch plugs on and off, but never put a script on them, change their
 * configuration or point them at another server.
 *
 * Shelly asks no password on its outbound WebSocket (Authentication, «all communication is
 * protected except: … Outbound Websocket»): this list is what guards it.
 *
 * Phase 2: what changes a plug (switching it, its schedules…) needs besides the signature of a
 * device given at this satellite (trust.ts), sent by Seilide as `Satelite.Firmada`; without one,
 * only on the plugs the family let Seilide switch by itself (`Satelite.Permiso`, signed too).
 */

/** Its only switch (`switch:0`), as Seilide's shelly.ts. */
const SWITCH_ID = 0;
/** Longest timer Seilide sets (Switch.Set's toggle_after): a day. */
const MAX_TOGGLE_S = 86_400;
/** A plug's frames are small (its whole state, about 1.5 KB). */
const MAX_PAYLOAD = 64 * 1024;
/** A plug that does not answer a ping in this long is dropped: Seilide must not see it online. */
const PING_MS = 30_000;
/** How often time alone is looked at for each plug's cycle (DONE_MS is minutes). */
const WATCH_TICK_MS = 30_000;

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

/**
 * A device's whole schedule for a plug (#643), signed: what Seilide's sync does in several orders,
 * done here in one. Off now (a pause) or on for a while (the long heat after one), then the jobs
 * the satellite or Seilide made replaced by these, each only switching it.
 */
export interface Schedules {
	jobs: { timespec: string; on: boolean; enable: boolean }[];
	/** Seilide's own jobs of before, to be replaced too: only if they only switch it. */
	replace: number[];
	off?: boolean;
	onFor?: number;
}

/** Shelly keeps up to 20 schedule jobs. */
const MAX_JOBS = 20;

export function schedulesOf(p: unknown): Schedules | null {
	if (!isObject(p) || !onlyKeys(p, ['jobs', 'replace', 'off', 'onFor'])) return null;
	if (!Array.isArray(p.jobs) || p.jobs.length > MAX_JOBS) return null;
	if (!Array.isArray(p.replace) || p.replace.length > MAX_JOBS) return null;
	if (!p.replace.every((id) => Number.isInteger(id))) return null;
	if (p.off !== undefined && typeof p.off !== 'boolean') return null;
	if (p.onFor !== undefined && !switchSet({ id: SWITCH_ID, on: true, toggle_after: p.onFor }))
		return null;
	const jobs = p.jobs.flatMap((j) =>
		isObject(j) &&
		onlyKeys(j, ['timespec', 'on', 'enable']) &&
		typeof j.on === 'boolean' &&
		typeof j.enable === 'boolean' &&
		CHANGE['Schedule.Create']!({
			enable: j.enable,
			timespec: j.timespec,
			calls: [{ method: 'Switch.Set', params: { id: SWITCH_ID, on: j.on } }]
		})
			? [{ timespec: j.timespec as string, on: j.on, enable: j.enable }]
			: []
	);
	if (jobs.length !== p.jobs.length) return null;
	return {
		jobs,
		replace: p.replace as number[],
		...(p.off ? { off: true } : {}),
		...(p.onFor ? { onFor: p.onFor as number } : {})
	};
}

/** Mutating orders a plug takes in a minute, at most: more is not a person. */
const MAX_CHANGES_PER_MIN = 30;

type Rpc = { id: number; src: string | null; method: string; params: unknown };

export type Verdict =
	| { ok: true; kind: 'read' | 'change'; rpc: Rpc }
	| { ok: false; id: number | null; src: string | null; why: string };

/** Whether a frame from Seilide is one of the allowed requests, and whether it only reads. */
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
	const rpc = { id, src, method, params: frame.params };
	if (READ.has(method)) return { ok: true, kind: 'read', rpc };
	if (method === 'Satelite.Estado' || method === 'Satelite.Firmada')
		return { ok: true, kind: 'read', rpc };
	const allowed = CHANGE[method];
	if (!allowed) return { ok: false, id, src, why: `${method} no está permitido` };
	if (!allowed(frame.params)) return { ok: false, id, src, why: `${method} con esos datos, no` };
	return { ok: true, kind: 'change', rpc };
}

/** The answer to Seilide for a refused order, as the plug's own errors, so it is not waited for. */
export const refusal = (id: number, dst: string | null, why: string) =>
	JSON.stringify({
		id,
		src: 'satelite',
		...(dst ? { dst } : {}),
		error: { code: 403, message: `El satélite no lo deja: ${why}` }
	});

const answer = (id: number, dst: string | null, result: unknown) =>
	JSON.stringify({ id, src: 'satelite', ...(dst ? { dst } : {}), result });

const asRpc = (r: Rpc) =>
	JSON.stringify({
		jsonrpc: '2.0',
		id: r.id,
		...(r.src ? { src: r.src } : {}),
		method: r.method,
		...(r.params === undefined ? {} : { params: r.params })
	});

/** What to do with a frame from Seilide: send it on to the plug, or answer Seilide. */
export type Decision =
	{ toPlug: string; change: boolean; by?: string } | { toSeilide: string | null; why?: string };

/**
 * A frame from Seilide for the plug `shellyId` (null until it has said who it is): read freely;
 * change only signed by a device given here, or with the family's permission for that plug.
 */
export function decide(text: string, trust: Trust, shellyId: string | null): Decision {
	const v = check(text);
	if (!v.ok) return { toSeilide: v.id === null ? null : refusal(v.id, v.src, v.why), why: v.why };
	const { rpc } = v;
	if (rpc.method === 'Satelite.Estado')
		return {
			toSeilide: answer(rpc.id, rpc.src, {
				satellite: trust.fp,
				auto: shellyId ? trust.auto(shellyId) : false
			})
		};
	if (rpc.method === 'Satelite.Firmada') {
		const p = rpc.params;
		if (!isObject(p) || typeof p.envelope !== 'string' || typeof p.sig !== 'string')
			return { toSeilide: refusal(rpc.id, rpc.src, 'orden firmada sin sentido'), why: 'firma' };
		const signed = trust.check(p.envelope, p.sig, shellyId);
		if (!signed.ok) return { toSeilide: refusal(rpc.id, rpc.src, signed.why), why: signed.why };
		if (signed.method === 'Satelite.Permiso') {
			const auto = signed.params?.auto;
			if (typeof auto !== 'boolean' || !shellyId)
				return { toSeilide: refusal(rpc.id, rpc.src, 'permiso sin sentido'), why: 'permiso' };
			trust.setAuto(shellyId, auto);
			return {
				toSeilide: answer(rpc.id, rpc.src, { auto }),
				why: `${signed.device}: Seilide ${auto ? 'puede' : 'ya no puede'} hacerlo solo`
			};
		}
		if (signed.method === 'Satelite.Horarios') {
			const batch = schedulesOf(signed.params);
			if (!batch || !shellyId)
				return { toSeilide: refusal(rpc.id, rpc.src, 'horarios sin sentido'), why: 'horarios' };
			return { batch, id: rpc.id, src: rpc.src, by: signed.device };
		}
		const inner = asRpc({ ...rpc, method: signed.method, params: signed.params });
		const w = check(inner);
		if (!w.ok || w.rpc.method.startsWith('Satelite.'))
			return {
				toSeilide: refusal(rpc.id, rpc.src, w.ok ? 'no se firma eso' : w.why),
				why: w.ok ? 'no se firma eso' : w.why
			};
		return { toPlug: inner, change: w.kind === 'change', by: signed.device };
	}
	if (v.kind === 'read') return { toPlug: text, change: false };
	if (shellyId && trust.auto(shellyId)) return { toPlug: text, change: true };
	const why = 'hace falta un aparato dado de alta (o el permiso «Seilide puede hacerlo solo»)';
	return { toSeilide: refusal(rpc.id, rpc.src, why), why: `${rpc.method} sin firma` };
}

export interface RelayOptions {
	port?: number;
	/** Seilide's `ws(s)://…/api/enchufe/`: the only place a plug's connection goes up to. */
	upstream: string;
	/** The satellite's key: Seilide knows the plug comes through it. */
	key: string;
	trust: Trust;
	log: (message: string) => void;
	/** Who may connect: the home's network (a test, also its own machine). */
	fromHome?: (ip: string) => boolean;
	/** Its other pages (alta.ts), on the same port: true if it answered. */
	page?: (req: IncomingMessage, res: ServerResponse) => boolean;
	/**
	 * A plug's appliance starts or ends a cycle (#651, phase 1), as Seilide's watch reads its watts:
	 * by its Shelly id, for the rules the satellite keeps.
	 */
	onCycle?: (shellyId: string, event: CycleEvent) => void;
	now?: () => number;
}

/** The plugs' WebSocket, and the satellite's pages, here; closed with `close()`. */
export function startRelay({
	port = RELAY_PORT,
	upstream,
	key,
	trust,
	log,
	fromHome = isHomeIp,
	page,
	onCycle,
	now = Date.now
}: RelayOptions) {
	/**
	 * Each plug's cycle (#651), by its Shelly id: kept across its reconnections, as Seilide keeps its
	 * own (plugs/notices.ts). Only the cycle: the notices are still Seilide's.
	 */
	const watches = new Map<string, PlugWatch>();
	/** The plugs that have come through here since it started, by their Shelly id (#651). */
	const seenPlugs = new Set<string>();
	const cycleOf = (shellyId: string, events: string[]) => {
		for (const e of events)
			if (e === 'started' || e === 'finished') {
				log(`Enchufe ${shellyId}: ${e === 'started' ? 'empieza un ciclo' : 'acaba un ciclo'}`);
				onCycle?.(shellyId, e);
			}
	};
	const ticker = setInterval(() => {
		for (const [id, w] of watches) cycleOf(id, w.tick(now()));
	}, WATCH_TICK_MS);
	ticker.unref?.();
	const watchOf = (shellyId: string) => {
		let w = watches.get(shellyId);
		if (!w) {
			w = new PlugWatch({ done: false, stopped: false, offline: false, onHours: null }, now());
			watches.set(shellyId, w);
		}
		return w;
	};
	const http = createServer((req, res) => {
		const from = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
		if (fromHome(from) && page?.(req, res)) return;
		res.writeHead(404).end();
	});
	const server = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
	http.on('error', (err) => log(`Enchufes, sin puerto ${port}: ${err.message}`));
	http.on('upgrade', (req, socket, head) => {
		if (!RELAY_PATH.test(req.url ?? '')) return socket.destroy();
		server.handleUpgrade(req, socket, head, (ws) => server.emit('connection', ws, req));
	});
	http.listen(port);

	server.on('connection', (plug: WebSocket, req: IncomingMessage) => {
		const from = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
		const token = req.url?.match(RELAY_PATH)?.[1];
		if (!fromHome(from) || !token) return plug.close(1008, 'No');

		const up = new WebSocket(`${upstream}${token}`, {
			headers: { 'x-api-key': key },
			maxPayload: MAX_PAYLOAD
		});
		const early: string[] = [];
		/** Who it is, as its own frames say (`src`): signed orders name it. */
		let shellyId: string | null = null;
		let changes: number[] = [];
		let alive = true;
		/** The satellite's own orders to the plug (a schedule batch): their answers stay here. */
		let ownId = 1_000_000_000;
		const ownCalls = new Map<number, { ok: (r: unknown) => void; ko: (e: Error) => void }>();
		const plugCall = (method: string, params?: Record<string, unknown>) =>
			new Promise<unknown>((ok, ko) => {
				const id = ownId++;
				const timer = setTimeout(() => {
					ownCalls.delete(id);
					ko(new Error(`${method}: sin respuesta`));
				}, 5000);
				ownCalls.set(id, {
					ok: (r) => (clearTimeout(timer), ok(r)),
					ko: (e) => (clearTimeout(timer), ko(e))
				});
				plug.send(JSON.stringify({ jsonrpc: '2.0', id, src: 'satelite', method, params }));
			});
		/** The schedule batch (#643): done in order, its new jobs' ids back to Seilide. */
		async function runBatch(b: Extract<Decision, { batch: Schedules }>) {
			const id = shellyId!;
			try {
				if (b.batch.off) await plugCall('Switch.Set', { id: SWITCH_ID, on: false });
				if (b.batch.onFor)
					await plugCall('Switch.Set', { id: SWITCH_ID, on: true, toggle_after: b.batch.onFor });
				const { jobs } = (await plugCall('Schedule.List')) as {
					jobs: { id: number; calls?: { method?: string }[] }[];
				};
				const mine = new Set([...trust.jobsOf(id), ...b.batch.replace]);
				for (const job of jobs ?? [])
					if (mine.has(job.id) && job.calls?.every((c) => c.method === 'Switch.Set'))
						await plugCall('Schedule.Delete', { id: job.id });
				const made: number[] = [];
				for (const job of b.batch.jobs) {
					const r = (await plugCall('Schedule.Create', {
						enable: job.enable,
						timespec: job.timespec,
						calls: [{ method: 'Switch.Set', params: { id: SWITCH_ID, on: job.on } }]
					})) as { id: number };
					made.push(r.id);
				}
				trust.setJobs(id, made);
				log(`Enchufe ${id}: horarios firmados por ${b.by}`);
				up.send(answer(b.id, b.src, { jobs: made }));
			} catch (err) {
				const why = err instanceof Error ? err.message : String(err);
				log(`Enchufe ${id}: horarios a medias (${why})`);
				up.send(
					JSON.stringify({
						id: b.id,
						src: 'satelite',
						...(b.src ? { dst: b.src } : {}),
						error: { code: 500, message: `Horarios a medias: ${why}` }
					})
				);
			}
		}
		const pinger = setInterval(() => {
			if (!alive) return plug.terminate();
			alive = false;
			plug.ping();
		}, PING_MS);
		const end = () => {
			clearInterval(pinger);
			if (shellyId) watches.get(shellyId)?.gone(now());
			if (plug.readyState === WebSocket.OPEN) plug.close();
			if (up.readyState === WebSocket.OPEN || up.readyState === WebSocket.CONNECTING)
				up.terminate();
		};

		plug.on('pong', () => (alive = true));
		plug.on('message', (data) => {
			const text = String(data);
			// An answer to the satellite's own order: not for Seilide.
			if (ownCalls.size)
				try {
					const f = JSON.parse(text) as {
						id?: number;
						result?: unknown;
						error?: { message?: string };
					};
					const own = typeof f.id === 'number' ? ownCalls.get(f.id) : undefined;
					if (own) {
						ownCalls.delete(f.id!);
						if (f.error) own.ko(new Error(f.error.message ?? 'error'));
						else own.ok(f.result);
						return;
					}
				} catch {
					// Not JSON: on to Seilide, as anything else it says.
				}
			if (!shellyId)
				try {
					const src = (JSON.parse(text) as { src?: unknown }).src;
					if (typeof src === 'string' && /^shelly[\w-]{1,80}$/i.test(src)) {
						shellyId = src;
						seenPlugs.add(src);
					}
				} catch {
					// Not JSON: passed on as it is; Seilide does not understand it either.
				}
			// Its watts, for the cycle: whatever happens with Seilide.
			const reading = shellyId ? switchReading(text) : null;
			if (reading)
				cycleOf(shellyId!, watchOf(shellyId!).seen(reading.power, reading.output, now()));
			if (up.readyState === WebSocket.OPEN) up.send(text);
			else early.push(text);
		});
		up.on('open', () => {
			for (const text of early.splice(0)) up.send(text);
		});
		up.on('message', (data) => {
			const decision = decide(String(data), trust, shellyId);
			if ('batch' in decision) {
				const at = now();
				changes = changes.filter((t) => t > at - 60_000);
				if (changes.length >= MAX_CHANGES_PER_MIN)
					return up.send(refusal(decision.id, 'seilide', 'demasiadas órdenes en un minuto'));
				changes.push(at);
				return void runBatch(decision);
			}
			if ('toPlug' in decision) {
				if (decision.change) {
					const at = now();
					changes = changes.filter((t) => t > at - 60_000);
					if (changes.length >= MAX_CHANGES_PER_MIN) {
						const id = (JSON.parse(decision.toPlug) as { id: number }).id;
						log(`Enchufe ${shellyId ?? from}: demasiadas órdenes`);
						return up.send(refusal(id, 'seilide', 'demasiadas órdenes en un minuto'));
					}
					changes.push(at);
					if (decision.by) log(`Enchufe ${shellyId ?? from}: orden firmada por ${decision.by}`);
				}
				return plug.send(decision.toPlug);
			}
			if (decision.why) log(`Enchufe ${shellyId ?? from}: ${decision.why}`);
			if (decision.toSeilide) up.send(decision.toSeilide);
		});
		plug.on('close', end);
		up.on('close', end);
		plug.on('error', end);
		up.on('error', (err) => {
			log(`Enchufe ${from}, sin Seilide: ${err.message}`);
			end();
		});
	});

	return {
		/** Whether that plug has come through here (#651: its rules said by voice). */
		hasPlug: (shellyId: string) => seenPlugs.has(shellyId),
		close: () => (clearInterval(ticker), server.close(), http.close())
	};
}
