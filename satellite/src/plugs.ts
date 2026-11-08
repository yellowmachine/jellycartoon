import mdns from 'multicast-dns';
import type { FoundPlug, PlugTask, PlugTaskResult } from '../../packages/comun/src/voice.ts';

/**
 * Smart plugs set up from the satellite (#396): it is inside the home's network, as Seilide is not.
 * It finds the Shelly Gen2+ there by mDNS (`_shelly._tcp`, as they announce themselves), and points
 * one at Seilide when told: its outbound WebSocket on, with the address Seilide gave, and a restart.
 * After that the plug talks to Seilide by itself: nothing of it goes through the satellite.
 *
 * mDNS needs the host's network (`network_mode: host` in compose.prod.yaml): Docker's bridge does
 * not pass multicast.
 */

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

async function getJson(url: string, init?: RequestInit) {
	const res = await fetch(url, { ...init, signal: AbortSignal.timeout(HTTP_MS) });
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

const rpc = (ip: string, method: string, params?: Record<string, unknown>) =>
	getJson(`http://${ip}/rpc`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ id: 1, method, params })
	});

async function describe(ip: string): Promise<FoundPlug | null> {
	const shelly = await shellyAt(ip);
	if (!shelly) return null;
	let server: string | null = null;
	if (!shelly.auth) {
		try {
			const ws = await getJson(`http://${ip}/rpc/Ws.GetConfig`);
			if (ws.enable === true && typeof ws.server === 'string') server = ws.server;
		} catch {
			// It says nothing of it: as if off.
		}
	}
	return { ...shelly, ip, server };
}

/** The Shelly Gen2+ in the home's network now. */
export async function findPlugs(): Promise<FoundPlug[]> {
	const found = await Promise.all([...(await shellyAddresses())].map(describe));
	return found
		.filter((p): p is FoundPlug => p !== null)
		.sort((a, b) => a.deviceId.localeCompare(b.deviceId));
}

export class PlugProblem extends Error {}

/**
 * That plug pointed at Seilide: only at an address of its own Seilide (`allowed`), only if it is
 * still the same plug at that IP, and only without a password.
 */
export async function setUpPlug(
	task: Extract<PlugTask, { kind: 'configurar' }>,
	allowed: string | null
) {
	if (!allowed || !task.server.startsWith(allowed))
		throw new PlugProblem('Esa dirección no es de Seilide');
	if (!isHomeIp(task.ip)) throw new PlugProblem('Esa IP no es de casa');
	const shelly = await shellyAt(task.ip);
	if (!shelly || shelly.deviceId !== task.deviceId)
		throw new PlugProblem('Ese enchufe ya no está en esa IP: búscalo otra vez');
	if (shelly.auth)
		throw new PlugProblem(
			'El enchufe tiene contraseña: quítasela un momento en su página, o conéctalo a mano'
		);
	const set = await rpc(task.ip, 'Ws.SetConfig', {
		config: { enable: true, server: task.server }
	});
	if ('error' in set) throw new PlugProblem('El enchufe no aceptó la dirección');
	// Its outbound WebSocket starts only after a restart.
	await rpc(task.ip, 'Shelly.Reboot').catch(() => {});
}

/** A task done: what it found, or what went wrong, for Seilide. */
export async function doPlugTask(task: PlugTask, allowed: string | null): Promise<PlugTaskResult> {
	try {
		if (task.kind === 'buscar') return { id: task.id, found: await findPlugs() };
		await setUpPlug(task, allowed);
		return { id: task.id };
	} catch (err) {
		return {
			id: task.id,
			problem: err instanceof PlugProblem ? err.message : 'No se pudo hablar con el enchufe'
		};
	}
}
