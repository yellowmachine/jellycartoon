import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('$app/env/private', () => ({
	APP_VERSION: '1.0.0',
	WUD_URL: 'http://wud:3000',
	WUD_PASSWORD: 'secreto'
}));
mock.module('#lib/server/log.ts', () => ({ log: { info() {}, warn() {}, error() {} } }));
const { startUpdate, versionInfo } = await import('./updates.ts');

const app = (updateAvailable: boolean) => ({
	id: 'app1',
	updateAvailable,
	labels: { 'com.docker.compose.service': 'app' }
});
const caddy = {
	id: 'caddy1',
	updateAvailable: false,
	labels: { 'com.docker.compose.service': 'caddy' }
};

/** WUD's API: what each `METHOD path` answers, and every request made. */
let routes: Record<string, unknown>;
let calls: string[];
const realFetch = globalThis.fetch;
afterAll(() => {
	globalThis.fetch = realFetch;
});
beforeEach(() => {
	calls = [];
	globalThis.fetch = (async (input: URL, init?: RequestInit) => {
		const key = `${init?.method ?? 'GET'} ${new URL(input).pathname}`;
		calls.push(key);
		if (!(key in routes)) return new Response('', { status: 404 });
		return Response.json(routes[key]);
	}) as typeof fetch;
});

describe('startUpdate', () => {
	test('WUD does not know the app yet: it is asked to look, and installs on its own', async () => {
		routes = {
			'GET /api/containers': [caddy],
			'POST /api/containers/watch': [caddy, app(true)]
		};
		expect(await startUpdate()).toBe('started');
		// Never the trigger as well: that would update twice at once.
		expect(calls).toEqual(['GET /api/containers', 'POST /api/containers/watch']);
	});

	test('WUD does not know the app, and there is nothing new', async () => {
		routes = {
			'GET /api/containers': [caddy],
			'POST /api/containers/watch': [caddy, app(false)]
		};
		expect(await startUpdate()).toBe('not-ready');
	});

	test('the app is not watched at all', async () => {
		routes = { 'GET /api/containers': [caddy], 'POST /api/containers/watch': [caddy] };
		expect(startUpdate()).rejects.toThrow('WUD no vigila la app');
	});

	test('an update WUD already knew of: the trigger, by hand', async () => {
		routes = {
			'GET /api/containers': [caddy, app(true)],
			'POST /api/containers/app1/triggers/docker/jellycartoon': {}
		};
		expect(await startUpdate()).toBe('started');
		expect(calls).toEqual([
			'GET /api/containers',
			'POST /api/containers/app1/triggers/docker/jellycartoon'
		]);
	});

	test('a new one: WUD looks at the app and installs it on its own', async () => {
		routes = {
			'GET /api/containers': [caddy, app(false)],
			'POST /api/containers/app1/watch': app(true)
		};
		expect(await startUpdate()).toBe('started');
		expect(calls).toEqual(['GET /api/containers', 'POST /api/containers/app1/watch']);
	});

	test('nothing new yet', async () => {
		routes = {
			'GET /api/containers': [caddy, app(false)],
			'POST /api/containers/app1/watch': app(false)
		};
		expect(await startUpdate()).toBe('not-ready');
	});
});

test('versionInfo: the notice remembers GitHub for hours; Ajustes asks it again', async () => {
	const release = (tag: string) => ({
		tag_name: tag,
		name: tag,
		body: 'Novedades',
		html_url: `https://github.com/yellowmachine/jellycartoon/releases/tag/${tag}`
	});
	const latest = 'GET /repos/yellowmachine/jellycartoon/releases/latest';

	routes = { [latest]: release('v1.0.0') };
	expect((await versionInfo()).update).toBeNull();

	// 1.0.1 is published: the notice still says nothing, from what it remembers…
	routes = { [latest]: release('v1.0.1') };
	expect((await versionInfo()).update).toBeNull();
	// …but opening Ajustes asks again,
	expect((await versionInfo({ fresh: true })).update?.version).toBe('1.0.1');
	// and from then on the notice knows it too.
	routes = {};
	expect((await versionInfo()).update?.version).toBe('1.0.1');
});
