import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { doEnrolTask, pageHtml } from './alta.ts';
import { check, decide, refusal, startRelay } from './relay.ts';
import { createTrust, enrolledText, enrollText, fingerprint } from './trust.ts';
import type { PlugGuard } from '../../packages/comun/src/plug-rules.ts';

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

	test('«cumple la regla N» (#651, fase 4): unsigned, only its rule id, and only once it knows the plug', () => {
		const trust = newTrust();
		expect(decide(ask('Satelite.Cumple', { rule: 12 }), trust, PLUG)).toEqual({
			asked: 12,
			id: 7,
			src: 'seilide'
		});
		for (const params of [{ rule: 12, on: true }, { rule: '12' }, undefined])
			expect('toSeilide' in decide(ask('Satelite.Cumple', params), trust, PLUG)).toBe(true);
		expect('toSeilide' in decide(ask('Satelite.Cumple', { rule: 12 }), trust, null)).toBe(true);
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

		// Seilide gone (#651): the plug stays with the satellite, which tries Seilide again.
		up.ws.close();
		await new Promise((r) => setTimeout(r, 50));
		expect(plug.readyState).toBe(WebSocket.OPEN);
		const closed = new Promise((resolve) => plug.on('close', resolve));
		plug.close();
		await closed;
		open.close();
	});

	test('a signed schedule batch: done here, only switch jobs replaced, their ids to Seilide', async () => {
		const { d } = await enrolled(trust);
		const open = startRelay({
			port: relayPort + 3,
			upstream: `ws://127.0.0.1:${seilidePort}/api/enchufe/`,
			key: 'k',
			trust,
			log: () => {},
			fromHome: () => true
		});
		const atSeilide = new Promise<WebSocket>((resolve) =>
			seilide.once('connection', (ws) => ws.once('message', () => resolve(ws)))
		);
		const plug = new WebSocket(`ws://127.0.0.1:${relayPort + 3}/enchufe/${'b'.repeat(43)}`);
		const asked: { method: string; params?: Record<string, unknown> }[] = [];
		let next = 11;
		plug.on('message', (m) => {
			const f = JSON.parse(String(m));
			asked.push({ method: f.method, params: f.params });
			const result =
				f.method === 'Schedule.List'
					? {
							jobs: [
								{ id: 5, calls: [{ method: 'Switch.Set' }] },
								{ id: 9, calls: [{ method: 'Shelly.Update' }] }
							]
						}
					: f.method === 'Schedule.Create'
						? { id: next++ }
						: {};
			plug.send(JSON.stringify({ id: f.id, src: PLUG, result }));
		});
		plug.on('open', () => plug.send(JSON.stringify({ src: PLUG, method: 'NotifyFullStatus' })));
		const up = await atSeilide;
		const fromRelay: string[] = [];
		up.on('message', (m) => fromRelay.push(String(m)));
		up.send(
			await signed(d, trust, 'Satelite.Horarios', {
				jobs: [
					{ timespec: '0 0 7 * * MON', on: true, enable: true },
					{ timespec: '0 0 8 * * MON', on: false, enable: true }
				],
				replace: [5, 9],
				off: true
			})
		);
		await new Promise((r) => setTimeout(r, 100));
		expect(asked.map((a) => a.method)).toEqual([
			'Switch.Set',
			'Schedule.List',
			'Schedule.Delete',
			'Schedule.Create',
			'Schedule.Create'
		]);
		expect(asked[2]!.params).toEqual({ id: 5 });
		expect(fromRelay.map((t) => JSON.parse(t))).toEqual([
			{ id: 7, src: 'satelite', dst: 'seilide', result: { jobs: [11, 12] } }
		]);
		expect(trust.jobsOf(PLUG)).toEqual([11, 12]);
		// A job that does more is never one of its: not accepted signed either.
		expect(
			'toSeilide' in
				decide(
					await signed(d, trust, 'Satelite.Horarios', {
						jobs: [{ timespec: '* * * * * *', on: true, enable: true, method: 'Script.Start' }],
						replace: []
					}),
					trust,
					PLUG
				)
		).toBe(true);
		plug.close();
		open.close();
	});

	test('a signed plan (#651, fase 5): its jobs off while it heats, back by itself when it ends', async () => {
		const { d } = await enrolled(trust);
		let t = Date.now();
		let guard: PlugGuard | undefined = undefined;
		const open = startRelay({
			port: relayPort + 6,
			upstream: `ws://127.0.0.1:${seilidePort}/api/enchufe/`,
			key: 'k',
			trust,
			log: () => {},
			fromHome: () => true,
			guardOf: () => guard,
			now: () => t
		});
		const atSeilide = new Promise<WebSocket>((resolve) =>
			seilide.once('connection', (ws) => ws.once('message', () => resolve(ws)))
		);
		const plug = new WebSocket(`ws://127.0.0.1:${relayPort + 6}/enchufe/${'e'.repeat(43)}`);
		const asked: { method: string; params?: Record<string, unknown> }[] = [];
		const jobs = new Map<number, unknown>();
		let next = 21;
		plug.on('message', (m) => {
			const f = JSON.parse(String(m));
			asked.push({ method: f.method, params: f.params });
			let result: unknown = {};
			if (f.method === 'Schedule.List')
				result = {
					jobs: [...jobs.keys()].map((id) => ({ id, calls: [{ method: 'Switch.Set' }] }))
				};
			if (f.method === 'Schedule.Create') {
				jobs.set(next, f.params);
				result = { id: next++ };
			}
			if (f.method === 'Schedule.Delete') jobs.delete(f.params.id);
			plug.send(JSON.stringify({ id: f.id, src: PLUG, result }));
		});
		plug.on('open', () => plug.send(JSON.stringify({ src: PLUG, method: 'NotifyFullStatus' })));
		const up = await atSeilide;
		await new Promise((r) => setTimeout(r, 1100));
		asked.length = 0;
		const base = [
			{ timespec: '0 0 7 * * 1', on: true, enable: true },
			{ timespec: '0 0 8 * * 1', on: false, enable: true }
		];
		// Out of a long pause, a water heater heats 4 hours: its jobs off until then.
		const heatUntil = t + 4 * 3_600_000;
		up.send(
			await signed(d, trust, 'Satelite.Horarios', {
				jobs: base,
				replace: [],
				onFor: 4 * 3600,
				plan: { paused: false, heatUntil, skipFrom: null, skipUntil: null }
			})
		);
		await new Promise((r) => setTimeout(r, 100));
		const enables = () =>
			asked.filter((a) => a.method === 'Schedule.Create').map((a) => a.params!.enable);
		expect(asked[0]).toEqual({
			method: 'Switch.Set',
			params: { id: 0, on: true, toggle_after: 4 * 3600 }
		});
		expect(enables()).toEqual([false, false]);
		// Still heating: nothing to write.
		asked.length = 0;
		open.followPlans();
		await new Promise((r) => setTimeout(r, 50));
		expect(asked).toEqual([]);
		// Its heat over, without Seilide: its jobs back.
		t = heatUntil + 1000;
		open.followPlans();
		await new Promise((r) => setTimeout(r, 100));
		expect(enables()).toEqual([true, true]);
		expect([...jobs.values()].map((j) => (j as { enable: boolean }).enable)).toEqual([true, true]);
		// «Esta tarde no», said unsigned: only its «on» job off; never switched.
		asked.length = 0;
		guard = {
			locked: false,
			paused: false,
			heatUntil: null,
			skipFrom: t,
			skipUntil: t + 3_600_000
		};
		open.followPlans();
		await new Promise((r) => setTimeout(r, 100));
		expect(enables()).toEqual([false, true]);
		expect(asked.some((a) => a.method === 'Switch.Set')).toBe(false);
		// A heat longer than a day is not a plan.
		expect(
			'toSeilide' in
				decide(
					await signed(d, trust, 'Satelite.Horarios', {
						jobs: base,
						replace: [],
						plan: {
							paused: false,
							heatUntil: Date.now() + 3 * 86_400_000,
							skipFrom: null,
							skipUntil: null
						}
					}),
					trust,
					PLUG
				)
		).toBe(true);
		plug.close();
		open.close();
	});

	test('Seilide asks for a rule (#651, fase 4): its answer, or why not, as from the plug', async () => {
		const asked: string[] = [];
		const open = startRelay({
			port: relayPort + 5,
			upstream: `ws://127.0.0.1:${seilidePort}/api/enchufe/`,
			key: 'k',
			trust,
			log: () => {},
			fromHome: () => true
		});
		open.onAsked(async (id, rule) => {
			asked.push(`${id} ${rule}`);
			return rule === 12 ? { ok: true } : { ok: false, why: 'no es su hora' };
		});
		const atSeilide = new Promise<WebSocket>((resolve) =>
			seilide.once('connection', (ws) => ws.once('message', () => resolve(ws)))
		);
		const plug = new WebSocket(`ws://127.0.0.1:${relayPort + 5}/enchufe/${'d'.repeat(43)}`);
		plug.on('open', () =>
			plug.send(JSON.stringify({ src: PLUG, method: 'NotifyFullStatus', params: {} }))
		);
		const ws = await atSeilide;
		const next = () => new Promise<string>((r) => ws.once('message', (m) => r(String(m))));
		let answer = next();
		ws.send(ask('Satelite.Cumple', { rule: 12 }));
		expect(JSON.parse(await answer)).toMatchObject({ id: 7, result: { done: true } });
		answer = next();
		ws.send(ask('Satelite.Cumple', { rule: 13 }));
		expect(JSON.parse(await answer)).toMatchObject({
			id: 7,
			error: { code: 403, message: 'El satélite no lo deja: no es su hora' }
		});
		expect(asked).toEqual([`${PLUG} 12`, `${PLUG} 13`]);
		plug.close();
		open.close();
	});

	test('a cycle of its appliance, read from its watts on the way up (#651)', async () => {
		let t = 0;
		const cycles: string[] = [];
		const open = startRelay({
			port: relayPort + 3,
			upstream: `ws://127.0.0.1:${seilidePort}/api/enchufe/`,
			key: 'k',
			trust,
			log: () => {},
			fromHome: () => true,
			onCycle: (id, e) => cycles.push(`${id} ${e}`),
			now: () => t
		});
		const atSeilide = new Promise<WebSocket>((resolve) =>
			seilide.once('connection', (ws) => resolve(ws))
		);
		const up: string[] = [];
		const plug = new WebSocket(`ws://127.0.0.1:${relayPort + 3}/enchufe/${'b'.repeat(43)}`);
		await new Promise((resolve) => plug.on('open', resolve));
		const ws = await atSeilide;
		ws.on('message', (m) => up.push(String(m)));
		const watts = (apower: number) =>
			JSON.stringify({ src: PLUG, method: 'NotifyStatus', params: { 'switch:0': { apower } } });
		const at = async (ms: number, w: number) => {
			t = ms;
			plug.send(watts(w));
			await new Promise((r) => setTimeout(r, 30));
		};
		await at(0, 1800);
		// Six minutes washing: a cycle, not a blip.
		await at(6 * 60_000, 1700);
		expect(cycles).toEqual([`${PLUG} started`]);
		await at(7 * 60_000, 1);
		// Idle more than three minutes after it: finished.
		await at(11 * 60_000, 0);
		expect(cycles).toEqual([`${PLUG} started`, `${PLUG} finished`]);
		// And Seilide got all it said, as it is.
		expect(up).toHaveLength(4);
		plug.close();
		open.close();
	});

	test('without Seilide, the plug stays; back, Seilide gets its whole state (#651)', async () => {
		const open = startRelay({
			port: relayPort + 4,
			upstream: `ws://127.0.0.1:${seilidePort}/api/enchufe/`,
			key: 'k',
			trust,
			log: () => {},
			fromHome: () => true,
			upRetryMs: 50
		});
		// Once its first frame is up: the satellite has seen Seilide's side open.
		const first = new Promise<WebSocket>((resolve) =>
			seilide.once('connection', (ws) => ws.once('message', () => resolve(ws)))
		);
		const plug = new WebSocket(`ws://127.0.0.1:${relayPort + 4}/enchufe/${'c'.repeat(43)}`);
		// The plug answers its status, as a Shelly does.
		plug.on('message', (m) => {
			const f = JSON.parse(String(m)) as { id: number; method: string };
			if (f.method === 'Shelly.GetStatus')
				plug.send(
					JSON.stringify({ id: f.id, src: PLUG, result: { 'switch:0': { output: true } } })
				);
		});
		await new Promise((resolve) => plug.on('open', resolve));
		plug.send(JSON.stringify({ src: PLUG, method: 'NotifyFullStatus', params: {} }));
		const up = await first;
		const second = new Promise<{ ws: WebSocket; first: string }>((resolve) =>
			seilide.once('connection', (ws) =>
				ws.once('message', (m) => resolve({ ws, first: String(m) }))
			)
		);
		// Seilide goes (no internet): the plug is not closed.
		up.terminate();
		await new Promise((r) => setTimeout(r, 30));
		expect(plug.readyState).toBe(WebSocket.OPEN);
		const back = await second;
		expect(JSON.parse(back.first)).toEqual({
			src: PLUG,
			dst: 'seilide',
			method: 'NotifyFullStatus',
			params: { 'switch:0': { output: true } }
		});
		expect(plug.readyState).toBe(WebSocket.OPEN);
		// And when the plug goes, Seilide's side with it.
		const closed = new Promise((resolve) => back.ws.on('close', resolve));
		plug.close();
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
