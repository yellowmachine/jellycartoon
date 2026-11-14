/**
 * The app's screenshots for the landing page (#495), made again whenever a screen changes: a
 * throwaway Seilide (compose.yaml, no volumes), an invented family (datos.ts), a pretend house for
 * Música and Carretera (casa-falsa.ts), and a headless Chromium as an installed app on a phone.
 * They land in static/capturas/ as .webp. Everything is removed at the end, also on failure.
 *
 *   bun scripts/capturas/capturas.ts            (from nube/; builds the app if there is no build/)
 *   bun scripts/capturas/capturas.ts --build    (builds it again first)
 *   bun scripts/capturas/capturas.ts gastos     (only those named)
 *
 * Needs Docker, openssl and Chromium (CHROMIUM, /usr/bin/chromium without it).
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Subprocess } from 'bun';

const NUBE = path.resolve(import.meta.dir, '../..');
const OUT = path.join(NUBE, 'static/capturas');
const COMPOSE = ['docker', 'compose', '-f', path.join(import.meta.dir, 'compose.yaml')];
const APP_PORT = 3472;
const HOUSE_PORT = 19443;
const CDP_PORT = 9333;
const APP = `http://127.0.0.1:${APP_PORT}`;
const OWNER_DB = 'postgres://nube:nube@127.0.0.1:5437/nube';
const APP_DB = 'postgres://nube_app:nube_app@127.0.0.1:5437/nube';
const EMAIL = 'ana@ejemplo.es';
const PASSWORD = 'capturas-de-ejemplo-2026';
/** A phone (390 × 844 CSS px), twice as sharp: 780 px wide images. */
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };

/** What is shot: its file in static/capturas/, its page, and how long it may settle. */
const SHOTS = [
	{ name: 'gastos', path: '/gastos' },
	{ name: 'agenda', path: '/agenda' },
	{ name: 'carretera', path: '/carretera' },
	{ name: 'musica', path: '/musica' }
];

/**
 * Before any page's script: installed (display-mode standalone), in Madrid for Carretera (called
 * back later, as a real GPS: at once loops an $effect), and every request with the headers the
 * app takes its own address from (PROTOCOL_HEADER, HOST_HEADER), sent by CDP below.
 */
const BEFORE = `
(() => {
	const real = window.matchMedia.bind(window);
	window.matchMedia = (q) => q.includes('display-mode: standalone')
		? { matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } }
		: real(q);
	const here = { coords: { latitude: 40.4168, longitude: -3.7038, accuracy: 8, speed: 0, heading: null, altitude: null, altitudeAccuracy: null }, timestamp: Date.now() };
	const geo = {
		getCurrentPosition: (ok) => setTimeout(() => ok({ ...here, timestamp: Date.now() }), 50),
		watchPosition: (ok) => { setTimeout(() => ok({ ...here, timestamp: Date.now() }), 50); return 1; },
		clearWatch() {}
	};
	Object.defineProperty(navigator, 'geolocation', { get: () => geo });
})();`;

const run = async (cmd: string[], env: Record<string, string> = {}) => {
	const proc = Bun.spawn(cmd, {
		cwd: NUBE,
		env: { ...process.env, ...env },
		stdout: 'pipe',
		stderr: 'pipe'
	});
	const [out, err, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited
	]);
	if (code !== 0) throw new Error(`${cmd.join(' ')} → ${code}\n${out}${err}`);
	return out;
};

async function waitFor(what: string, check: () => Promise<boolean>, seconds = 60) {
	for (let i = 0; i < seconds * 4; i++) {
		if (await check().catch(() => false)) return;
		await Bun.sleep(250);
	}
	throw new Error(`${what} no arrancó en ${seconds} s`);
}

/** A form action, as the browser would post it, with the session's cookie. */
async function post(url: string, fields: Record<string, string>, cookie = '') {
	const res = await fetch(url, {
		method: 'POST',
		redirect: 'manual',
		headers: {
			origin: APP,
			'x-forwarded-proto': 'http',
			'x-forwarded-host': `127.0.0.1:${APP_PORT}`,
			cookie,
			'content-type': 'application/x-www-form-urlencoded'
		},
		body: new URLSearchParams(fields)
	});
	if (res.status >= 400) throw new Error(`${url} → ${res.status} ${await res.text()}`);
	return res;
}

/** Chromium's DevTools protocol, one target at a time. */
async function devtools(wsUrl: string) {
	const ws = new WebSocket(wsUrl);
	await new Promise((ok, no) => {
		ws.onopen = ok;
		ws.onerror = no;
	});
	let next = 1;
	const waiting = new Map<number, (msg: { result?: unknown; error?: unknown }) => void>();
	const events: ((msg: { method: string; params: unknown }) => void)[] = [];
	ws.onmessage = (e) => {
		const msg = JSON.parse(String(e.data));
		if (msg.id) waiting.get(msg.id)?.(msg);
		else for (const listen of events) listen(msg);
	};
	const send = <T = Record<string, unknown>>(method: string, params: object = {}) =>
		new Promise<T>((ok, no) => {
			const id = next++;
			waiting.set(id, (msg) =>
				msg.error ? no(new Error(`${method}: ${JSON.stringify(msg.error)}`)) : ok(msg.result as T)
			);
			ws.send(JSON.stringify({ id, method, params }));
		});
	const once = (method: string) =>
		new Promise<void>((ok) => events.push((msg) => msg.method === method && ok()));
	return { send, once, close: () => ws.close() };
}

const children: Subprocess[] = [];
const work = await mkdtemp(path.join(tmpdir(), 'seilide-capturas-'));
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const shots = only.length ? SHOTS.filter((s) => only.includes(s.name)) : SHOTS;

try {
	console.log('· base de datos y ficheros');
	await run([...COMPOSE, 'up', '-d', '--wait']);
	await run(['bun', 'scripts/migrate.ts'], { MIGRATE_DATABASE_URL: OWNER_DB });
	const made = await run(['bun', 'scripts/crear-familia.ts', 'Casa García', EMAIL], {
		MIGRATE_DATABASE_URL: OWNER_DB,
		ORIGIN: APP
	});
	const token = made.match(/\/invitacion\/([\w-]+)/)?.[1];
	if (!token) throw new Error(`Sin invitación: ${made}`);

	console.log('· casa de ejemplo');
	const cert = path.join(work, 'cert.pem');
	const key = path.join(work, 'key.pem');
	await run([
		'openssl',
		'req',
		'-x509',
		'-newkey',
		'rsa:2048',
		'-nodes',
		'-days',
		'1',
		'-subj',
		'/CN=127.0.0.1',
		'-keyout',
		key,
		'-out',
		cert
	]);
	children.push(
		Bun.spawn(['bun', path.join(import.meta.dir, 'casa-falsa.ts'), String(HOUSE_PORT), cert, key], {
			cwd: NUBE,
			stdout: 'inherit',
			stderr: 'inherit'
		})
	);

	if (
		process.argv.includes('--build') ||
		!(await Bun.file(path.join(NUBE, 'build/index.js')).exists())
	) {
		console.log('· compilando');
		// As the Dockerfile: without them, the build stops at «Analysing routes».
		await run(['bun', 'run', 'build'], {
			DATABASE_URL: 'postgres://build/build',
			ORIGIN: 'http://localhost',
			BETTER_AUTH_SECRET: 'build'
		});
	}

	console.log('· Seilide');
	const mapDir = path.join(work, 'mapa');
	await mkdir(mapDir);
	// As in production, where there is one: Carretera's «Ruta» without «Sin mapa». Not drawn on a phone.
	await writeFile(path.join(mapDir, 'espana.pmtiles'), '');
	children.push(
		Bun.spawn(['bun', 'server.js'], {
			cwd: NUBE,
			env: {
				...process.env,
				PORT: String(APP_PORT),
				HOST: '127.0.0.1',
				ORIGIN: APP,
				PROTOCOL_HEADER: 'x-forwarded-proto',
				HOST_HEADER: 'x-forwarded-host',
				DATABASE_URL: APP_DB,
				BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
				S3_ENDPOINT: 'http://127.0.0.1:19002',
				S3_BUCKET: 'nube',
				S3_ACCESS_KEY_ID: 'nube',
				S3_SECRET_ACCESS_KEY: 'nube-desarrollo',
				MAP_DIR: mapDir,
				ROUTE_MAPS_DIR: mapDir,
				// The pretend house's certificate is made for the run.
				NODE_TLS_REJECT_UNAUTHORIZED: '0'
			},
			stdout: Bun.file(path.join(work, 'seilide.log')),
			stderr: Bun.file(path.join(work, 'seilide.err.log'))
		})
	);
	await waitFor('Seilide', async () => (await fetch(APP)).status < 500);

	console.log('· cuenta y datos');
	const signed = await post(`${APP}/invitacion/${token}?/signUp`, {
		name: 'Ana',
		password: PASSWORD
	});
	const session = signed.headers
		.getSetCookie()
		.map((c) => c.split(';')[0]!)
		.find((c) => c.includes('session_token'));
	if (!session) throw new Error('Sin sesión al crear la cuenta');
	await run(['bun', path.join(import.meta.dir, 'datos.ts'), OWNER_DB, EMAIL]);
	await post(
		`${APP}/ajustes?/saveHouse`,
		{
			url: `https://127.0.0.1:${HOUSE_PORT}`,
			key: `casita_${randomBytes(16).toString('hex')}`,
			webUrl: ''
		},
		session
	);

	console.log('· Chromium');
	const chromium = Bun.spawn(
		[
			process.env.CHROMIUM ?? '/usr/bin/chromium',
			'--headless=new',
			`--remote-debugging-port=${CDP_PORT}`,
			`--user-data-dir=${path.join(work, 'chromium')}`,
			'--ignore-certificate-errors',
			'--no-first-run',
			'--hide-scrollbars',
			'--mute-audio',
			'about:blank'
		],
		{ stdout: 'ignore', stderr: 'ignore' }
	);
	children.push(chromium);
	await waitFor(
		'Chromium',
		async () => (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok
	);

	await mkdir(OUT, { recursive: true });
	// Its value may end in «=»: only the first one splits.
	const cut = session.indexOf('=');
	const [cookieName, cookieValue] = [session.slice(0, cut), session.slice(cut + 1)];
	for (const shot of shots) {
		// A tab of its own each: the app's open event streams hold connections (HTTP/1.1 here).
		const target = await (
			await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })
		).json();
		const cdp = await devtools(target.webSocketDebuggerUrl);
		await cdp.send('Page.enable');
		await cdp.send('Network.enable');
		await cdp.send('Network.setCookie', {
			name: cookieName,
			value: cookieValue,
			url: APP,
			httpOnly: true
		});
		await cdp.send('Network.setExtraHTTPHeaders', {
			headers: { 'x-forwarded-proto': 'http', 'x-forwarded-host': `127.0.0.1:${APP_PORT}` }
		});
		await cdp.send('Emulation.setDeviceMetricsOverride', PHONE);
		await cdp.send('Emulation.setEmulatedMedia', {
			features: [{ name: 'prefers-color-scheme', value: 'dark' }]
		});
		await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: BEFORE });
		const loaded = cdp.once('Page.loadEventFired');
		await cdp.send('Page.navigate', { url: APP + shot.path });
		await loaded;
		// The covers, the streamed catalog, the fonts.
		await Bun.sleep(2500);
		const { data } = await cdp.send<{ data: string }>('Page.captureScreenshot', {
			format: 'webp',
			quality: 82
		});
		await writeFile(path.join(OUT, `${shot.name}.webp`), Buffer.from(data, 'base64'));
		console.log(`  ✓ static/capturas/${shot.name}.webp`);
		cdp.close();
		await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${target.id}`);
	}
} catch (error) {
	console.error(error);
	console.error(`Registro de Seilide en ${work}`);
	process.exitCode = 1;
} finally {
	for (const child of children) child.kill(9);
	await run([...COMPOSE, 'down', '-v']).catch((e) => console.error(e));
	if (!process.exitCode) await rm(work, { recursive: true, force: true });
}
