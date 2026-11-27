import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { doEnrolTask, pageHtml } from './alta.ts';
import { check, decide, refusal, startRelay } from './relay.ts';
import { createTrust, enrolledText, enrollText, fingerprint } from './trust.ts';

/**
 * What Seilide may ask of a plug through the satellite (#643): only what it uses (phase 1), and
 * what changes it only signed by a device given here, or with the family's permission (phase 2).
 * Signed as a browser does: WebCrypto's ECDSA P-256 and HMAC.
 */

const PLUG = 'shellyplugmg3-1';
const ask = (method: string, params?: unknown) =>
	JSON.stringify({ jsonrpc: '2.0', id: 7, src: 'seilide', method, params });
const b64 = (b: ArrayBuffer) => Buffer.from(b).toString('base64url');
const newTrust = (now?: () => number) =>
	createTrust(join(mkdtempSync(join(tmpdir(), 'trust-')), 'seguridad.json'), now);

/** A device as Seilide's page makes it: its key, its fingerprint. */
async function device() {
	const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
		'sign',
		'verify'
	]);
	const spki = b64(await crypto.subtle.exportKey('spki', pair.publicKey));
	return { pair, spki, fp: fingerprint(spki) };
}

async function macOf(code: string, spki: string, name: string) {
	const secret = Buffer.from(code.split('.')[0]!, 'base64url');
	const key = await crypto.subtle.importKey(
		'raw',
		secret,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	return b64(
		await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(enrollText(spki, name)))
	);
}

async function enrolled(trust = newTrust()) {
	const d = await device();
	const w = trust.openEnrolment();
	const done = trust.enrol(d.spki, 'Móvil', await macOf(trust.code(w), d.spki, 'Móvil'));
	if (!done.ok) throw new Error(done.why);
	return { trust, d, done };
}

let nonce = 0;
async function signed(
	d: Awaited<ReturnType<typeof device>>,
	trust: ReturnType<typeof createTrust>,
	method: string,
	params?: Record<string, unknown>,
	over: Record<string, unknown> = {}
) {
	const envelope = JSON.stringify({
		v: 1,
		sat: trust.fp,
		dev: d.fp,
		plug: PLUG,
		method,
		params,
		ts: Date.now(),
		nonce: `n${nonce++}`,
		...over
	});
	const sig = b64(
		await crypto.subtle.sign(
			{ name: 'ECDSA', hash: 'SHA-256' },
			d.pair.privateKey,
			new TextEncoder().encode(envelope)
		)
	);
	return ask('Satelite.Firmada', { envelope, sig });
}

describe('what goes down to the plug', () => {
	test('what Seilide uses, with its own parameters', () => {
		for (const frame of [
			ask('Shelly.GetDeviceInfo'),
			ask('Wifi.GetStatus'),
			ask('Switch.GetStatus', { id: 0 }),
			ask('Sys.GetConfig'),
			ask('Schedule.List'),
			ask('Switch.Set', { id: 0, on: true }),
			ask('Switch.Set', { id: 0, on: false, toggle_after: 1800 }),
			ask('Sys.SetConfig', { config: { location: { tz: 'Europe/Madrid' } } }),
			ask('Schedule.Create', {
				enable: true,
				timespec: '0 0 7 * * MON',
				calls: [{ method: 'Switch.Set', params: { id: 0, on: true } }]
			}),
			ask('Schedule.Delete', { id: 3 }),
			ask('Ws.SetConfig', { config: { enable: false } }),
			ask('Shelly.Reboot')
		])
			expect(check(frame).ok).toBe(true);
		expect(check(ask('Wifi.GetStatus'))).toMatchObject({ kind: 'read' });
		expect(check(ask('Switch.Set', { id: 0, on: true }))).toMatchObject({ kind: 'change' });
	});

	test('never a script, another server, a password, an update or a schedule that does more', () => {
		for (const frame of [
			ask('Script.Create', { name: 'x' }),
			ask('Script.PutCode', { id: 1, code: 'HTTP.GET(…)' }),
			ask('Ws.SetConfig', { config: { enable: true, server: 'wss://malo.example' } }),
			ask('Shelly.SetAuth', { user: 'admin', realm: 'x', ha1: null }),
			ask('Shelly.Update', { stage: 'stable' }),
			ask('Shelly.FactoryReset'),
			ask('Sys.SetConfig', { config: { debug: { websocket: { enable: true } } } }),
			ask('Sys.SetConfig', { config: { location: { tz: 'Europe/Madrid', lat: 1 } } }),
			ask('Schedule.Create', {
				timespec: '* * * * * *',
				calls: [{ method: 'Script.Start', params: { id: 1 } }]
			}),
			ask('Switch.Set', { id: 0, on: true, extra: 1 }),
			ask('Switch.Set', { id: 1, on: true }),
			ask('Switch.SetConfig', { id: 0, config: { auto_off: true } }),
			ask('HTTP.GET', { url: 'http://192.168.1.1' }),
			JSON.stringify({ id: 7, method: 'Switch.Set', params: { id: 0, on: true }, auth: {} }),
			'no es json',
			JSON.stringify({ id: 7, result: {} })
		])
			expect(check(frame).ok).toBe(false);
	});

	test('refused, Seilide is answered as by the plug, so as not to wait', () => {
		expect(JSON.parse(refusal(7, 'seilide', 'Script.Create no está permitido'))).toEqual({
			id: 7,
			src: 'satelite',
			dst: 'seilide',
			error: { code: 403, message: 'El satélite no lo deja: Script.Create no está permitido' }
		});
	});
});

describe('signed orders (phase 2)', () => {
	test('reading, always; changing without a signature, only with the permission', async () => {
		const trust = newTrust();
		expect(decide(ask('Wifi.GetStatus'), trust, PLUG)).toMatchObject({ change: false });
		const refused = decide(ask('Switch.Set', { id: 0, on: false }), trust, PLUG);
		expect('toSeilide' in refused && JSON.parse(refused.toSeilide!).error.code).toBe(403);
		trust.setAuto(PLUG, true);
		expect(decide(ask('Switch.Set', { id: 0, on: false }), trust, PLUG)).toMatchObject({
			change: true
		});
		// Another plug: its own permission.
		expect(
			'toSeilide' in decide(ask('Switch.Set', { id: 0, on: false }), trust, 'shellyotro')
		).toBe(true);
	});

	test('its state, for Seilide', () => {
		const trust = newTrust();
		const d = decide(ask('Satelite.Estado'), trust, PLUG);
		expect('toSeilide' in d && JSON.parse(d.toSeilide!).result).toEqual({
			satellite: trust.fp,
			auto: false
		});
	});

	test('a device given with the code switches it; its order goes down as a plain RPC', async () => {
		const { trust, d, done } = await enrolled();
		// The satellite's answer, checked as the page does: by the fingerprint in the code.
		const satKey = await crypto.subtle.importKey(
			'spki',
			Buffer.from(done.satellite, 'base64url'),
			{ name: 'ECDSA', namedCurve: 'P-256' },
			false,
			['verify']
		);
		expect(fingerprint(done.satellite)).toBe(trust.fp);
		expect(
			await crypto.subtle.verify(
				{ name: 'ECDSA', hash: 'SHA-256' },
				satKey,
				Buffer.from(done.ack, 'base64url'),
				new TextEncoder().encode(enrolledText(d.fp))
			)
		).toBe(true);

		const order = await signed(d, trust, 'Switch.Set', { id: 0, on: true });
		const out = decide(order, trust, PLUG);
		expect(out).toMatchObject({ change: true, by: 'Móvil' });
		expect(JSON.parse((out as { toPlug: string }).toPlug)).toEqual({
			jsonrpc: '2.0',
			id: 7,
			src: 'seilide',
			method: 'Switch.Set',
			params: { id: 0, on: true }
		});
		// Once only.
		expect('toSeilide' in decide(order, trust, PLUG)).toBe(true);
	});

	test('the permission, only signed', async () => {
		const { trust, d } = await enrolled();
		expect(
			decide(await signed(d, trust, 'Satelite.Permiso', { auto: true }), trust, PLUG)
		).toMatchObject({
			toSeilide: expect.stringContaining('"auto":true')
		});
		expect(trust.auto(PLUG)).toBe(true);
		// Unsigned, it is not even a method.
		expect(check(ask('Satelite.Permiso', { auto: false })).ok).toBe(false);
	});

	test('refused: another satellite, plug or device, old, tampered, or not allowed even signed', async () => {
		const { trust, d } = await enrolled();
		const stranger = await device();
		const why = async (order: string, shellyId: string | null = PLUG) => {
			const out = decide(order, trust, shellyId);
			return 'toSeilide' in out ? JSON.parse(out.toSeilide!).error?.message : 'pasó';
		};
		const on = { id: 0, on: true };
		expect(await why(await signed(d, trust, 'Switch.Set', on, { sat: 'otro' }))).toContain(
			'otro satélite'
		);
		expect(await why(await signed(d, trust, 'Switch.Set', on, { plug: 'shellyotro' }))).toContain(
			'otro enchufe'
		);
		expect(await why(await signed(d, trust, 'Switch.Set', on), null)).toContain('otro enchufe');
		expect(await why(await signed(stranger, trust, 'Switch.Set', on))).toContain(
			'no está dado de alta'
		);
		expect(
			await why(await signed(d, trust, 'Switch.Set', on, { ts: Date.now() - 10 * 60_000 }))
		).toContain('caducada');
		expect(await why(await signed(d, trust, 'Script.PutCode', { id: 1, code: 'x' }))).toContain(
			'no está permitido'
		);
		const good = JSON.parse(await signed(d, trust, 'Switch.Set', on));
		good.params.envelope = good.params.envelope.replace('"on":true', '"on":false');
		expect(await why(JSON.stringify(good))).toContain('la firma no vale');
	});

	test('the code: once, while open, only with its MAC', async () => {
		const trust = newTrust();
		const d = await device();
		expect(trust.enrol(d.spki, 'x', 'AAAA')).toMatchObject({ ok: false });
		const w = trust.openEnrolment();
		expect(
			trust.enrol(d.spki, 'Móvil', await macOf(trust.code(w), d.spki, 'Otro nombre'))
		).toMatchObject({
			ok: false
		});
		expect(trust.enrol(d.spki, 'Móvil', await macOf(trust.code(w), d.spki, 'Móvil'))).toMatchObject(
			{
				ok: true
			}
		);
		const again = await device();
		expect(
			trust.enrol(again.spki, 'Móvil', await macOf(trust.code(w), again.spki, 'Móvil'))
		).toMatchObject({ ok: false });
		expect(trust.devices().map((x) => x.fp)).toEqual([d.fp]);
		// Its page: the code only while open, never after.
		expect(pageHtml(trust)).toContain('El alta está cerrada');
		expect(pageHtml(trust)).not.toContain(w.secret);
	});

	test('the window opens only just after the satellite heard an order', () => {
		const trust = newTrust();
		const task = { id: 't', kind: 'abrir-alta' as const };
		expect(doEnrolTask(task, trust, () => 5 * 60_000)?.problem).toContain('diciéndoselo');
		const opened = doEnrolTask(
			task,
			trust,
			() => 2000,
			() => '192.168.68.61'
		);
		expect(opened).toMatchObject({ url: 'http://192.168.68.61:8790/alta' });
		expect(JSON.stringify(opened)).not.toContain(trust.enrolment()!.secret);
		expect(pageHtml(trust)).toContain(trust.code(trust.enrolment()!));
	});

	test('kept across a restart: its key, its devices, its permissions', async () => {
		const file = join(mkdtempSync(join(tmpdir(), 'trust-')), 'seguridad.json');
		const { trust } = await enrolled(createTrust(file));
		trust.setAuto(PLUG, true);
		const again = createTrust(file);
		expect(again.fp).toBe(trust.fp);
		expect(again.devices()).toHaveLength(1);
		expect(again.auto(PLUG)).toBe(true);
	});
});

describe('the relay', () => {
	const seilide = new WebSocketServer({ port: 0 });
	const seilidePort = (seilide.address() as { port: number }).port;
	const relayPort = 18790 + Math.floor(Math.random() * 1000);
	const trust = newTrust();
	const relay = startRelay({
		port: relayPort,
		upstream: `ws://127.0.0.1:${seilidePort}/api/enchufe/`,
		key: 'clave-del-satelite',
		trust,
		log: () => {}
	});
	afterAll(() => {
		relay.close();
		seilide.close();
	});

	test('only from the home network', async () => {
		// 127.0.0.1 is not a home address (RFC 1918): refused.
		const plug = new WebSocket(`ws://127.0.0.1:${relayPort}/enchufe/${'a'.repeat(43)}`);
		const code = await new Promise<number>((resolve) => plug.on('close', (c) => resolve(c)));
		expect(code).toBe(1008);
	});

	test('through it: what the plug says goes up, what is allowed comes down, the rest is answered', async () => {
		const { d } = await enrolled(trust);
		const open = startRelay({
			port: relayPort + 1,
			upstream: `ws://127.0.0.1:${seilidePort}/api/enchufe/`,
			key: 'clave-del-satelite',
			trust,
			log: () => {},
			fromHome: () => true
		});
		const token = 'a'.repeat(43);
		const full = JSON.stringify({ src: PLUG, method: 'NotifyFullStatus', params: {} });
		const atSeilide = new Promise<{ ws: WebSocket; url: string; key: string; first: string }>(
			(resolve) =>
				seilide.once('connection', (ws, req) =>
					ws.once('message', (data) =>
						resolve({
							ws,
							url: req.url!,
							key: String(req.headers['x-api-key']),
							first: String(data)
						})
					)
				)
		);
		const plug = new WebSocket(`ws://127.0.0.1:${relayPort + 1}/enchufe/${token}`);
		const toPlug: string[] = [];
		plug.on('message', (m) => toPlug.push(String(m)));
		// Its whole state at once, maybe before Seilide's side is open: kept and sent.
		plug.on('open', () => plug.send(full));
		const up = await atSeilide;
		expect(up.url).toBe(`/api/enchufe/${token}`);
		expect(up.key).toBe('clave-del-satelite');
		expect(up.first).toBe(full);

		const next = () =>
			new Promise<string>((resolve) => up.ws.once('message', (m) => resolve(String(m))));
		let answer = next();
		up.ws.send(ask('Script.PutCode', { id: 1, code: 'x' }));
		expect(JSON.parse(await answer)).toMatchObject({ id: 7, error: { code: 403 } });
		// Unsigned, without the permission: refused too.
		answer = next();
		up.ws.send(ask('Switch.Set', { id: 0, on: true }));
		expect(JSON.parse(await answer)).toMatchObject({ error: { code: 403 } });
		// Signed by the device: down.
		up.ws.send(await signed(d, trust, 'Switch.Set', { id: 0, on: true }));
		await new Promise((r) => setTimeout(r, 50));
		expect(toPlug.map((t) => JSON.parse(t).method)).toEqual(['Switch.Set']);

		// Seilide gone: the plug's connection too, so that it tries again by itself.
		const closed = new Promise((resolve) => plug.on('close', resolve));
		up.ws.close();
		await closed;
		open.close();
	});

	test('its page, from home only', async () => {
		const open = startRelay({
			port: relayPort + 2,
			upstream: `ws://127.0.0.1:${seilidePort}/api/enchufe/`,
			key: 'k',
			trust,
			log: () => {},
			fromHome: () => true,
			page: (await import('./alta.ts')).altaPage(trust)
		});
		const res = await fetch(`http://127.0.0.1:${relayPort + 2}/alta`);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('Aparatos dados de alta');
		expect((await fetch(`http://127.0.0.1:${relayPort}/alta`)).status).toBe(404);
		open.close();
	});
});

describe('its password (ALTA_CLAVE)', () => {
	test('opens the window from its page; wrong five times, locked a while', async () => {
		const { altaPage, passwordGate } = await import('./alta.ts');
		let at = 0;
		const gate = passwordGate('buena', () => at);
		expect(gate.try('mala')).toBe(false);
		for (let i = 0; i < 4; i++) gate.try('mala');
		expect(gate.try('buena')).toBeNull();
		at = 16 * 60_000;
		expect(gate.try('buena')).toBe(true);
		expect(passwordGate(null).try('')).toBe(false);

		const trust = newTrust();
		const port = 19900 + Math.floor(Math.random() * 90);
		const relay = startRelay({
			port,
			upstream: 'ws://127.0.0.1:1/api/enchufe/',
			key: 'k',
			trust,
			log: () => {},
			fromHome: () => true,
			page: altaPage(trust, passwordGate('buena'))
		});
		const post = (clave: string) =>
			fetch(`http://127.0.0.1:${port}/alta/abrir`, {
				method: 'POST',
				body: new URLSearchParams({ clave }),
				redirect: 'manual'
			});
		expect((await post('mala')).status).toBe(403);
		expect(trust.enrolment()).toBeNull();
		expect((await post('buena')).status).toBe(303);
		expect(trust.enrolment()).not.toBeNull();
		// From another site: no.
		const other = await fetch(`http://127.0.0.1:${port}/alta/abrir`, {
			method: 'POST',
			headers: { origin: 'http://malo.example' },
			body: new URLSearchParams({ clave: 'buena' }),
			redirect: 'manual'
		});
		expect(other.status).toBe(403);
		relay.close();
	});
});
