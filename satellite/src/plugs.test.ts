import { afterEach, describe, expect, test } from 'bun:test';
import { doPlugTask, isHomeIp } from './plugs.ts';

/** Plugs set up from the satellite (#396): only in the home's network, only for its own Seilide. */

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

/** A Shelly at 192.168.1.50 that answers as the Plug M Gen3 did; what it was asked, kept. */
function fakeShelly({ auth = false, id = 'shellyplugmg3-1' } = {}) {
	const asked: { url: string; body?: unknown }[] = [];
	globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
		const url = String(input);
		asked.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
		if (url.endsWith('/shelly'))
			return Response.json({ id, model: 'S3PL-30110EU', gen: 3, auth_en: auth });
		if (url.endsWith('/rpc')) return Response.json({ id: 1, result: { restart_required: true } });
		return new Response('', { status: 404 });
	}) as typeof fetch;
	return asked;
}

const ALLOWED = 'wss://seilide.app/api/enchufe/';
const task = (over: object = {}) => ({
	id: 't1',
	kind: 'configurar' as const,
	ip: '192.168.1.50',
	deviceId: 'shellyplugmg3-1',
	server: `${ALLOWED}${'a'.repeat(43)}`,
	...over
});

describe('plugs from the satellite', () => {
	test('home IPs only', () => {
		expect(isHomeIp('192.168.68.57')).toBe(true);
		expect(isHomeIp('10.0.0.3')).toBe(true);
		expect(isHomeIp('172.20.1.1')).toBe(true);
		expect(isHomeIp('172.32.1.1')).toBe(false);
		expect(isHomeIp('8.8.8.8')).toBe(false);
		expect(isHomeIp('192.168.1.999')).toBe(false);
		expect(isHomeIp('seilide.app')).toBe(false);
	});

	test('set up: its outbound WebSocket on with that address, then a restart', async () => {
		const asked = fakeShelly();
		expect(await doPlugTask(task(), ALLOWED)).toEqual({ id: 't1' });
		const rpcs = asked.filter((a) => a.url === 'http://192.168.1.50/rpc').map((a) => a.body);
		expect(rpcs).toEqual([
			{
				id: 1,
				method: 'Ws.SetConfig',
				params: { config: { enable: true, server: task().server } }
			},
			{ id: 1, method: 'Shelly.Reboot' }
		]);
	});

	test('never to an address not of its Seilide, nor outside home', async () => {
		const asked = fakeShelly();
		expect(await doPlugTask(task({ server: 'wss://otro.example/x' }), ALLOWED)).toEqual({
			id: 't1',
			problem: 'Esa dirección no es de Seilide'
		});
		expect(await doPlugTask(task({ ip: '8.8.8.8' }), ALLOWED)).toMatchObject({
			problem: 'Esa IP no es de casa'
		});
		expect(await doPlugTask(task(), null)).toMatchObject({
			problem: 'Esa dirección no es de Seilide'
		});
		expect(asked).toEqual([]);
	});

	test('another plug at that IP now, or with a password: not touched', async () => {
		let asked = fakeShelly({ id: 'otro' });
		expect((await doPlugTask(task(), ALLOWED)).problem).toContain('ya no está en esa IP');
		expect(asked.some((a) => a.url.endsWith('/rpc'))).toBe(false);
		asked = fakeShelly({ auth: true });
		expect((await doPlugTask(task(), ALLOWED)).problem).toContain('contraseña');
		expect(asked.some((a) => a.url.endsWith('/rpc'))).toBe(false);
	});
});
