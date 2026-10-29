import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';

/**
 * The house's music in the satellite's room (#296): its own snapclient (Debian's, in its image),
 * playing from the snapserver Seilide tells it (Ajustes → Familia → «Satélites de voz»), started
 * again with the new one when it changes, and again if it stops. None told, none playing.
 */

/** Where it plays: `SNAPCLIENT_SOUNDCARD`, else the satellite's own speaker. */
const SOUNDCARD = process.env.SNAPCLIENT_SOUNDCARD || process.env.SPEAKER || 'default';
/**
 * How the snapserver knows it, the same after each update (its container's MAC is not): by its
 * key, unless `SNAPCLIENT_ID` says.
 */
const HOST_ID =
	process.env.SNAPCLIENT_ID ||
	`satelite-${createHash('sha256')
		.update(process.env.SATELLITE_KEY ?? '')
		.digest('hex')
		.slice(0, 8)}`;
/** Its server's control (JSON-RPC over HTTP), where its name is given. */
const CONTROL_PORT = 1780;
/** After starting, how long it may take to be among the server's clients; tried this often. */
const NAME_TRIES = 10;
const NAME_EVERY_MS = 3000;
/** The same line of its log, again only after this long. */
const LOG_EVERY_MS = 60_000;
/** Stopped by itself (the server gone, the network), started again this long after. */
const RETRY_MS = 5000;

let wanted: string | null = null;
let wantedName: string | null = null;
let current: ChildProcess | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;

/** «192.168.1.20» or «casa.local:1704»: its host and port. */
function addressOf(server: string) {
	const [host, port] = server.split(':');
	return { host: host!, port: port ?? '1704' };
}

/** One call to its server's control: its result, or null if it did not answer as expected. */
async function control(host: string, method: string, params: object) {
	const res = await fetch(`http://${host}:${CONTROL_PORT}/jsonrpc`, {
		method: 'POST',
		body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
		signal: AbortSignal.timeout(5000)
	});
	const body = (await res.json().catch(() => null)) as { result?: unknown } | null;
	return res.ok ? (body?.result ?? null) : null;
}

/**
 * Known there by its name («Dormitorio»), as the house lists its speakers, once it is among the
 * server's clients: only if it has none, so a name given in the house stays. Never fails.
 */
async function nameIt(server: string, name: string) {
	const { host } = addressOf(server);
	for (let i = 0; i < NAME_TRIES && wanted === server; i++) {
		await new Promise((resolve) => setTimeout(resolve, NAME_EVERY_MS));
		try {
			const status = (await control(host, 'Client.GetStatus', { id: HOST_ID })) as {
				client?: { config?: { name?: string } };
			} | null;
			if (!status?.client) continue;
			if (!status.client.config?.name) await control(host, 'Client.SetName', { id: HOST_ID, name });
			return;
		} catch {
			// Not yet, or its control not reachable: tried again, or left with its machine's name.
		}
	}
}

function start() {
	clearTimeout(retry);
	if (!wanted) return;
	const { host, port } = addressOf(wanted);
	const server = wanted;
	console.log(`Música de la casa: snapclient a ${host}:${port}, en ${SOUNDCARD}`);
	const child = spawn(
		'snapclient',
		[
			'--host',
			host,
			'--port',
			port,
			'--soundcard',
			SOUNDCARD,
			'--hostID',
			HOST_ID,
			'--logsink',
			'stderr'
		],
		{ stdio: ['ignore', 'ignore', 'pipe'] }
	);
	current = child;
	if (wantedName) void nameIt(server, wantedName);
	// Without its server it says the same few lines every second: each, once a minute at most.
	const said = new Map<string, number>();
	createInterface({ input: child.stderr! }).on('line', (line) => {
		const text = line.replace(/^\S+ \S+ /, '');
		const now = Date.now();
		if (now - (said.get(text) ?? 0) < LOG_EVERY_MS) return;
		said.set(text, now);
		console.log(`snapclient: ${text}`);
	});
	child.on('error', (err) => console.error('snapclient', err.message));
	child.on('exit', (code, signal) => {
		if (current === child) current = null;
		// Still the one wanted, and not stopped by us: again in a moment.
		if (wanted === server && signal !== 'SIGTERM') {
			console.error(`snapclient terminó (${code ?? signal}): otra vez en ${RETRY_MS / 1000} s`);
			retry = setTimeout(start, RETRY_MS);
		}
	});
}

/**
 * The snapserver told now (null, none), and its name there: the same, nothing; another, started
 * again with it.
 */
export function followSnapserver(server: string | null, name: string | null) {
	wantedName = name;
	if (server === wanted) return;
	wanted = server;
	clearTimeout(retry);
	const old = current;
	current = null;
	if (old) {
		old.once('exit', start);
		old.kill('SIGTERM');
	} else start();
	if (!server) console.log('Música de la casa: sin snapserver');
}
