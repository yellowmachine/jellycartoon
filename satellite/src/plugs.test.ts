import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digestHeader, doPlugTask, ha1Of, isHomeIp, ownAddressFor, upstreamOf } from './plugs.ts';

/** Plugs set up from the satellite (#396): only in the home's network, only for its own Seilide. */

const realFetch = globalThis.fetch;
let dir = '';
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'enchufes-'));
	process.env.PLUG_PASSWORDS_FILE = join(dir, 'enchufes.json');
});
afterEach(() => {
	globalThis.fetch = realFetch;
	rmSync(dir, { recursive: true, force: true });
});

/** The satellite, at .2 of the plug's network. */
const OWN = () => '192.168.1.2';
const saved = () => JSON.parse(readFileSync(process.env.PLUG_PASSWORDS_FILE!, 'utf8'));

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

	test('set up (#643): pointed at the satellite with its token, a password of its own, a restart', async () => {
		const asked = fakeShelly();
		expect(await doPlugTask(task(), ALLOWED, OWN)).toEqual({ id: 't1' });
		const rpcs = asked.filter((a) => a.url === 'http://192.168.1.50/rpc').map((a) => a.body);
		const password = saved()['shellyplugmg3-1'];
		expect(password).toHaveLength(32);
		expect(rpcs).toEqual([
			{
				id: 1,
				method: 'Ws.SetConfig',
				params: {
					config: { enable: true, server: `ws://192.168.1.2:8790/enchufe/${'a'.repeat(43)}` }
				}
			},
			{
				id: 1,
				method: 'Shelly.SetAuth',
				params: { user: 'admin', realm: 'shellyplugmg3-1', ha1: ha1Of('shellyplugmg3-1', password) }
			},
			{ id: 1, method: 'Shelly.Reboot' }
		]);
	});

	test("not in the plug's network: not touched", async () => {
		const asked = fakeShelly();
		expect((await doPlugTask(task(), ALLOWED, () => null)).problem).toContain('misma red');
		expect(asked.some((a) => a.url.endsWith('/rpc'))).toBe(false);
	});

	test('never to an address not of its Seilide, nor outside home', async () => {
		const asked = fakeShelly();
		expect(await doPlugTask(task({ server: 'wss://otro.example/x' }), ALLOWED, OWN)).toEqual({
			id: 't1',
			problem: 'Esa dirección no es de Seilide'
		});
		expect(
			await doPlugTask(task({ server: `${ALLOWED}x/../../otro` }), ALLOWED, OWN)
		).toMatchObject({
			problem: 'Esa dirección no es de Seilide'
		});
		expect(await doPlugTask(task({ ip: '8.8.8.8' }), ALLOWED, OWN)).toMatchObject({
			problem: 'Esa IP no es de casa'
		});
		expect(await doPlugTask(task(), null, OWN)).toMatchObject({
			problem: 'Esa dirección no es de Seilide'
		});
		expect(asked).toEqual([]);
	});

	test('another plug at that IP now, or with a password: not touched', async () => {
		let asked = fakeShelly({ id: 'otro' });
		expect((await doPlugTask(task(), ALLOWED, OWN)).problem).toContain('ya no está en esa IP');
		expect(asked.some((a) => a.url.endsWith('/rpc'))).toBe(false);
		asked = fakeShelly({ auth: true });
		expect((await doPlugTask(task(), ALLOWED, OWN)).problem).toContain('contraseña');
		expect(asked.some((a) => a.url.endsWith('/rpc'))).toBe(false);
	});

	test('its own address: the interface whose subnet holds the plug', () => {
		const nets = {
			lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: true }],
			docker0: [{ address: '172.17.0.1', netmask: '255.255.0.0', family: 'IPv4', internal: false }],
			wlan0: [
				{ address: '192.168.68.61', netmask: '255.255.252.0', family: 'IPv4', internal: false }
			]
		} as unknown as Parameters<typeof ownAddressFor>[1];
		expect(ownAddressFor('192.168.69.20', nets)).toBe('192.168.68.61');
		expect(ownAddressFor('10.0.0.5', nets)).toBeNull();
	});

	test('a plug pointed at a satellite is shown as its Seilide address', () => {
		const token = 'b'.repeat(43);
		expect(upstreamOf(`ws://192.168.1.2:8790/enchufe/${token}`, ALLOWED)).toEqual({
			server: `${ALLOWED}${token}`,
			relayed: true
		});
		expect(upstreamOf('wss://otro.example/x', ALLOWED)).toEqual({
			server: 'wss://otro.example/x',
			relayed: false
		});
		expect(upstreamOf(`ws://8.8.8.8:8790/enchufe/${token}`, ALLOWED).relayed).toBe(false);
	});

	test('digest as Shelly documents it (SHA-256, qop auth)', () => {
		const ha1 = ha1Of('shellyplugmg3-1', 'clave');
		const header = digestHeader(
			'Digest qop="auth", realm="shellyplugmg3-1", nonce="abc", algorithm=SHA-256',
			ha1,
			'POST',
			'/rpc'
		);
		const field = (n: string) => header.match(new RegExp(`${n}="?([^",]+)"?`))![1]!;
		const h = (t: string) => new Bun.CryptoHasher('sha256').update(t).digest('hex');
		expect(field('realm')).toBe('shellyplugmg3-1');
		expect(field('nonce')).toBe('abc');
		expect(field('response')).toBe(
			h(`${ha1}:abc:00000001:${field('cnonce')}:auth:${h('POST:/rpc')}`)
		);
	});
});
