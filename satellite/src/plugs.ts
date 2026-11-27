import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname } from 'node:path';
import mdns from 'multicast-dns';
import type { FoundPlug, PlugTask, PlugTaskResult } from '../../packages/comun/src/voice.ts';

/**
 * Smart plugs set up from the satellite (#396): it is inside the home's network, as Seilide is not.
 * It finds the Shelly Gen2+ there by mDNS (`_shelly._tcp`, as they announce themselves), and sets
 * one up when told (#643): its outbound WebSocket pointed at the satellite itself (relay.ts, which
 * takes it on to Seilide and lets down only what is allowed), a password of its own so that no one
 * else in the wifi changes it, and a restart.
 *
 * mDNS needs the host's network (`network_mode: host` in compose.prod.yaml): Docker's bridge does
 * not pass multicast.
 */

/** Where a plug connects here (relay.ts): `ws://<satellite>:<port>/enchufe/<its token>`. */
export const RELAY_PATH = /^\/enchufe\/([\w-]{43})$/;
export const RELAY_PORT = Number(process.env.PLUG_PORT ?? 8790);
const TOKEN = /^[\w-]{43}$/;

/**
 * The passwords the satellite gave its plugs, by their Shelly id: only here, never sent to Seilide.
 * In the satellite's volume, so they outlive a new image.
 */
const passwordsFile = () => process.env.PLUG_PASSWORDS_FILE ?? '/data/enchufes.json';

function passwords(): Record<string, string> {
	try {
		const saved = JSON.parse(readFileSync(passwordsFile(), 'utf8')) as unknown;
		return saved && typeof saved === 'object' ? (saved as Record<string, string>) : {};
	} catch {
		return {};
	}
}

const passwordOf = (deviceId: string) => passwords()[deviceId] ?? null;

function keepPassword(deviceId: string, password: string) {
	mkdirSync(dirname(passwordsFile()), { recursive: true });
	writeFileSync(passwordsFile(), JSON.stringify({ ...passwords(), [deviceId]: password }), {
		mode: 0o600
	});
}

/** How long it listens for their answers. */
const LOOK_MS = 3000;
const HTTP_MS = 3000;

/** Only in the home's network (RFC 1918): never anywhere else, whatever it is told. */
const PRIVATE_IP = /^(10\.\d+|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+$/;
export const isHomeIp = (ip: string) =>
	PRIVATE_IP.test(ip) && ip.split('.').every((n) => Number(n) <= 255);

/** The addresses of the Shelly announcing themselves now. */
function shellyAddresses(): Promise<Set<string>> {
	return new Promise((resolve) => {
		const ips = new Set<string>();
		let m: ReturnType<typeof mdns>;
		try {
			m = mdns();
		} catch {
			return resolve(ips);
		}
		m.on('error', () => {});
		m.on('response', (response) => {
			for (const record of [...response.answers, ...(response.additionals ?? [])])
				if (record.type === 'A' && /^shelly/i.test(record.name) && isHomeIp(String(record.data)))
					ips.add(String(record.data));
		});
		const ask = () => m.query({ questions: [{ name: '_shelly._tcp.local', type: 'PTR' }] });
		ask();
		// Once more: a multicast question can get lost.
		const again = setTimeout(ask, LOOK_MS / 3);
		setTimeout(() => {
			clearTimeout(again);
			m.destroy();
			resolve(ips);
		}, LOOK_MS);
	});
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * The plug's password, as Shelly wants it (Authentication, RFC 7616 with SHA-256): user `admin`,
 * realm its own id.
 */
export const ha1Of = (deviceId: string, password: string) =>
	sha256(`admin:${deviceId}:${password}`);

/** The answer to a `WWW-Authenticate: Digest …` challenge, for that request. */
export function digestHeader(challenge: string, ha1: string, method: string, uri: string) {
	const field = (name: string) => challenge.match(new RegExp(`${name}="?([^",]+)"?`))?.[1] ?? '';
	const realm = field('realm');
	const nonce = field('nonce');
	const nc = '00000001';
	const cnonce = randomBytes(8).toString('hex');
	const response = sha256(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${sha256(`${method}:${uri}`)}`);
	return `Digest username="admin", realm="${realm}", nonce="${nonce}", uri="${uri}", algorithm=SHA-256, qop=auth, nc=${nc}, cnonce="${cnonce}", response="${response}"`;
}

/** With `ha1`, a 401 is answered with the password, once. */
async function getJson(url: string, init?: RequestInit, ha1?: string | null) {
	let res = await fetch(url, { ...init, signal: AbortSignal.timeout(HTTP_MS) });
	const challenge = res.headers.get('www-authenticate');
	if (res.status === 401 && ha1 && challenge) {
		const uri = new URL(url);
		res = await fetch(url, {
			...init,
			headers: {
				...(init?.headers as Record<string, string> | undefined),
				authorization: digestHeader(
					challenge,
					ha1,
					init?.method ?? 'GET',
					uri.pathname + uri.search
				)
			},
			signal: AbortSignal.timeout(HTTP_MS)
		});
	}
	if (!res.ok) throw new Error(`${res.status}`);
	return res.json() as Promise<Record<string, unknown>>;
}

/** What a Shelly says of itself at `/shelly` (no password needed); null if not a Gen2+. */
async function shellyAt(ip: string) {
	try {
		const info = await getJson(`http://${ip}/shelly`);
		if (typeof info.id !== 'string' || typeof info.gen !== 'number' || info.gen < 2) return null;
		return {
			deviceId: info.id,
			model: typeof info.model === 'string' ? info.model : '',
			auth: info.auth_en === true
		};
	} catch {
		return null;
	}
}

const rpc = (ip: string, method: string, params?: Record<string, unknown>, ha1?: string | null) =>
	getJson(
		`http://${ip}/rpc`,
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id: 1, method, params })
		},
		ha1
	);

/** The plug's password as the satellite gave it; null if it has none, or one not of the satellite. */
const ha1For = (deviceId: string) => {
	const password = passwordOf(deviceId);
	return password ? ha1Of(deviceId, password) : null;
};

/**
 * Where a plug pointed at a satellite goes on to (relay.ts): its Seilide address, as if it pointed
 * there, and `relayed`. Any other address, as it is.
 */
export function upstreamOf(server: string, upstream: string | null) {
	let url: URL;
	try {
		url = new URL(server);
	} catch {
		return { server, relayed: false };
	}
	const token = url.pathname.match(RELAY_PATH)?.[1];
	if (url.protocol !== 'ws:' || !isHomeIp(url.hostname) || !token || !upstream)
		return { server, relayed: false };
	return { server: `${upstream}${token}`, relayed: true };
}

async function describe(ip: string, upstream: string | null): Promise<FoundPlug | null> {
	const shelly = await shellyAt(ip);
	if (!shelly) return null;
	const ha1 = shelly.auth ? ha1For(shelly.deviceId) : null;
	let server: string | null = null;
	let relayed = false;
	if (!shelly.auth || ha1) {
		try {
			const ws = await getJson(`http://${ip}/rpc/Ws.GetConfig`, undefined, ha1);
			if (ws.enable === true && typeof ws.server === 'string')
				({ server, relayed } = upstreamOf(ws.server, upstream));
		} catch {
			// It says nothing of it: as if off.
		}
	}
	// A password of the satellite's is no hindrance: only one it does not know.
	return { ...shelly, auth: shelly.auth && !ha1, ip, server, relayed };
}

/** The Shelly Gen2+ in the home's network now. */
export async function findPlugs(upstream: string | null = null): Promise<FoundPlug[]> {
	const found = await Promise.all(
		[...(await shellyAddresses())].map((ip) => describe(ip, upstream))
	);
	return found
		.filter((p): p is FoundPlug => p !== null)
		.sort((a, b) => a.deviceId.localeCompare(b.deviceId));
}

export class PlugProblem extends Error {}

const IPV4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/;
const ipNumber = (ip: string) => {
	const m = ip.match(IPV4);
	return m ? m.slice(1).reduce((n, part) => n * 256 + Number(part), 0) : null;
};

/**
 * The satellite's own address in the plug's network: the interface whose subnet holds the plug.
 * Null if it has none there.
 */
export function ownAddressFor(plugIp: string, interfaces = networkInterfaces()) {
	const plug = ipNumber(plugIp);
	if (plug === null) return null;
	for (const list of Object.values(interfaces))
		for (const net of list ?? []) {
			if (net.family !== 'IPv4' || net.internal) continue;
			const own = ipNumber(net.address);
			const mask = ipNumber(net.netmask);
			if (own !== null && mask !== null && (own & mask) >>> 0 === (plug & mask) >>> 0)
				return net.address;
		}
	return null;
}

/**
 * That plug set up (#643): only for an address of its own Seilide (`allowed`), whose token it
 * keeps; only if it is still the same plug at that IP; and only without a password or with the
 * satellite's own. Its outbound WebSocket to the satellite, a password of the satellite's if it
 * had none, and a restart.
 */
export async function setUpPlug(
	task: Extract<PlugTask, { kind: 'configurar' }>,
	allowed: string | null,
	ownAddress: (plugIp: string) => string | null = ownAddressFor
) {
	const token = allowed && task.server.startsWith(allowed) ? task.server.slice(allowed.length) : '';
	if (!TOKEN.test(token)) throw new PlugProblem('Esa dirección no es de Seilide');
	if (!isHomeIp(task.ip)) throw new PlugProblem('Esa IP no es de casa');
	const shelly = await shellyAt(task.ip);
	if (!shelly || shelly.deviceId !== task.deviceId)
		throw new PlugProblem('Ese enchufe ya no está en esa IP: búscalo otra vez');
	let ha1 = ha1For(shelly.deviceId);
	if (shelly.auth && !ha1)
		throw new PlugProblem(
			'El enchufe tiene una contraseña que el satélite no sabe: quítasela un momento en su página'
		);
	const own = ownAddress(task.ip);
	if (!own) throw new PlugProblem('El satélite no está en la misma red que el enchufe');

	const set = await rpc(
		task.ip,
		'Ws.SetConfig',
		{ config: { enable: true, server: `ws://${own}:${RELAY_PORT}/enchufe/${token}` } },
		ha1
	);
	if ('error' in set) throw new PlugProblem('El enchufe no aceptó la dirección');
	if (!shelly.auth) {
		// Kept before it is set: an answer lost on the way must not leave a password no one knows.
		const password = randomBytes(24).toString('base64url');
		keepPassword(shelly.deviceId, password);
		ha1 = ha1Of(shelly.deviceId, password);
		const auth = await rpc(task.ip, 'Shelly.SetAuth', {
			user: 'admin',
			realm: shelly.deviceId,
			ha1
		});
		if ('error' in auth) throw new PlugProblem('El enchufe no aceptó la contraseña');
	}
	// Its outbound WebSocket starts only after a restart.
	await rpc(task.ip, 'Shelly.Reboot', undefined, ha1).catch(() => {});
}

/** A task done: what it found, or what went wrong, for Seilide. */
export async function doPlugTask(
	task: PlugTask,
	allowed: string | null,
	ownAddress?: (plugIp: string) => string | null
): Promise<PlugTaskResult> {
	try {
		if (task.kind === 'buscar') return { id: task.id, found: await findPlugs(allowed) };
		await setUpPlug(task, allowed, ownAddress);
		return { id: task.id };
	} catch (err) {
		return {
			id: task.id,
			problem: err instanceof PlugProblem ? err.message : 'No se pudo hablar con el enchufe'
		};
	}
}
