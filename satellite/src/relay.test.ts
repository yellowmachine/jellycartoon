import { afterAll, describe, expect, test } from 'bun:test';
import { WebSocket, WebSocketServer } from 'ws';
import { check, refusal, startRelay } from './relay.ts';

/** What Seilide may ask of a plug through the satellite (#643): only what it uses, and nothing else. */

const ask = (method: string, params?: unknown) =>
	JSON.stringify({ jsonrpc: '2.0', id: 7, src: 'seilide', method, params });

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
			expect(check(frame)).toEqual({ ok: true });
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

describe('the relay', () => {
	const seilide = new WebSocketServer({ port: 0 });
	const seilidePort = (seilide.address() as { port: number }).port;
	const relayPort = 18790 + Math.floor(Math.random() * 1000);
	const relay = startRelay({
		port: relayPort,
		upstream: `ws://127.0.0.1:${seilidePort}/api/enchufe/`,
		key: 'clave-del-satelite',
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
		const open = startRelay({
			port: relayPort + 1,
			upstream: `ws://127.0.0.1:${seilidePort}/api/enchufe/`,
			key: 'clave-del-satelite',
			log: () => {},
			fromHome: () => true
		});
		const token = 'a'.repeat(43);
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
		plug.on('message', (d) => toPlug.push(String(d)));
		// Its whole state at once, maybe before Seilide's side is open: kept and sent.
		plug.on('open', () => plug.send('{"method":"NotifyFullStatus","params":{}}'));
		const up = await atSeilide;
		expect(up.url).toBe(`/api/enchufe/${token}`);
		expect(up.key).toBe('clave-del-satelite');
		expect(up.first).toBe('{"method":"NotifyFullStatus","params":{}}');

		const answer = new Promise<string>((resolve) =>
			up.ws.once('message', (d) => resolve(String(d)))
		);
		up.ws.send(ask('Script.PutCode', { id: 1, code: 'x' }));
		expect(JSON.parse(await answer)).toMatchObject({ id: 7, error: { code: 403 } });
		up.ws.send(ask('Switch.Set', { id: 0, on: true }));
		await new Promise((r) => setTimeout(r, 50));
		expect(toPlug.map((t) => JSON.parse(t).method)).toEqual(['Switch.Set']);

		// Seilide gone: the plug's connection too, so that it tries again by itself.
		const closed = new Promise((resolve) => plug.on('close', resolve));
		up.ws.close();
		await closed;
		open.close();
	});
});
