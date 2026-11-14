import { describe, expect, test } from 'bun:test';
import { createVerify } from 'node:crypto';
import {
	BunqError,
	bunqClient,
	cents,
	parseAccounts,
	parsePayments,
	signBody
} from './bunq-api.ts';
import { newKeyPair } from './bunq-api.ts';

/** bunq's API (#502) against a fake bunq: what it is sent, signed, and its session opened again. */

describe('lo que bunq contesta', () => {
	test('amounts in cents, negative going out', () => {
		expect(cents('-12.34')).toBe(-1234);
		expect(cents('5')).toBe(500);
		expect(cents('0.5')).toBe(50);
		expect(cents('-0.10')).toBe(-10);
		expect(cents('12,34')).toBeNull();
		expect(cents(12.34)).toBeNull();
	});

	test('accounts, whatever they are wrapped in, with their IBAN', () => {
		expect(
			parseAccounts([
				{
					MonetaryAccountBank: {
						id: 11,
						description: 'Principal',
						status: 'ACTIVE',
						alias: [
							{ type: 'EMAIL', value: 'a@b.c' },
							{ type: 'IBAN', value: 'NL00BUNQ0000000011', name: 'Ana' }
						]
					}
				},
				{
					MonetaryAccountSavings: {
						id: 12,
						description: '',
						display_name: 'Hucha',
						status: 'CANCELLED'
					}
				},
				{ MonetaryAccountJoint: { description: 'sin id' } }
			])
		).toEqual([
			{ id: 11, name: 'Principal', iban: 'NL00BUNQ0000000011', active: true },
			{ id: 12, name: 'Hucha', iban: null, active: false }
		]);
	});

	test('payments: their date in UTC, the other side, and those without an amount left out', () => {
		const [p, ...rest] = parsePayments([
			{
				Payment: {
					id: 7,
					created: '2026-11-13 23:30:00.123456',
					amount: { value: '-23.50', currency: 'EUR' },
					description: 'Compra',
					type: 'MASTERCARD',
					counterparty_alias: { display_name: 'MERCADONA VALENCIA', iban: null }
				}
			},
			{ Payment: { id: 8, created: '2026-11-13 10:00:00', amount: { value: 'x' } } }
		]);
		expect(rest).toEqual([]);
		expect(p).toEqual({
			id: 7,
			created: new Date('2026-11-13T23:30:00.123Z'),
			amount: -2350,
			currency: 'EUR',
			description: 'Compra',
			counterpartyName: 'MERCADONA VALENCIA',
			counterpartyIban: null,
			type: 'MASTERCARD'
		});
	});

	test('a body signed so that its public key verifies it', () => {
		const { publicKey, privateKey } = newKeyPair();
		const signature = signBody('{"a":1}', privateKey);
		expect(createVerify('sha256').update('{"a":1}').verify(publicKey, signature, 'base64')).toBe(
			true
		);
	});
});

/** A bunq of its own: installation, device, sessions (the first one expires), accounts, filters. */
function fakeBunq() {
	const calls: { method: string; path: string; headers: Record<string, string>; body: unknown }[] =
		[];
	let sessions = 0;
	let filters: unknown[] = [
		{ category: 'PAYMENT', notification_target: 'https://otra-app.example/hook' },
		{ category: 'MUTATION', notification_target: 'https://seilide.test/api/bancos/bunq/viejo' }
	];
	const ok = (items: unknown[], extra: object = {}) =>
		new Response(JSON.stringify({ Response: items, ...extra }), { status: 200 });
	const fetch = async (url: string, init: RequestInit) => {
		const path = new URL(url).pathname.replace(/^\/v1/, '') + new URL(url).search;
		const headers = init.headers as Record<string, string>;
		const body = init.body ? JSON.parse(String(init.body)) : null;
		calls.push({ method: init.method!, path, headers, body });
		if (path === '/installation')
			return ok([{ Id: { id: 1 } }, { Token: { token: 'inst' } }, { ServerPublicKey: {} }]);
		if (path === '/device-server')
			return body.secret === 'clave-buena-de-bunq-123'
				? ok([{ Id: { id: 2 } }])
				: new Response(JSON.stringify({ Error: [{ error_description: 'Bad key' }] }), {
						status: 400
					});
		if (path === '/session-server') {
			sessions++;
			return ok([
				{ Id: { id: 3 } },
				{ Token: { token: `ses${sessions}` } },
				{ UserPerson: { id: 99 } }
			]);
		}
		// The first session expires at once.
		if (headers['X-Bunq-Client-Authentication'] === 'ses1')
			return new Response(JSON.stringify({ Error: [{ error_description: 'Expired' }] }), {
				status: 401
			});
		if (path.startsWith('/user/99/monetary-account?'))
			return ok([{ MonetaryAccountBank: { id: 11, description: 'Principal', status: 'ACTIVE' } }]);
		if (path.startsWith('/user/99/monetary-account/11/payment'))
			return ok(
				[
					{
						Payment: {
							id: 5,
							created: '2026-11-13 10:00:00',
							amount: { value: '-1.00', currency: 'EUR' }
						}
					}
				],
				{ Pagination: { older_url: path.includes('older_id') ? null : '/v1/…?older_id=5' } }
			);
		if (path === '/user/99/notification-filter-url' && init.method === 'GET')
			return ok([{ NotificationFilterUrl: { notification_filters: filters } }]);
		if (path === '/user/99/notification-filter-url') {
			filters = body.notification_filters;
			return ok([]);
		}
		return new Response('{}', { status: 404 });
	};
	return { calls, fetch, filters: () => filters };
}

describe('el cliente de bunq', () => {
	test('a wrong key: bunq’s own error', async () => {
		const bunq = fakeBunq();
		const client = bunqClient({ base: 'https://bunq.test/v1', fetch: bunq.fetch });
		const err = await client.connect('mala').catch((e) => e);
		expect(err).toBeInstanceOf(BunqError);
		expect(err.status).toBe(400);
	});

	test('connected, then the expired session opened again once and kept', async () => {
		const bunq = fakeBunq();
		const kept: string[] = [];
		const client = bunqClient({
			base: 'https://bunq.test/v1',
			fetch: bunq.fetch,
			onSession: async (c) => void kept.push(c.sessionToken!)
		});
		const context = await client.connect('clave-buena-de-bunq-123');
		expect(context).toMatchObject({
			installationToken: 'inst',
			sessionToken: 'ses1',
			bankUserId: 99
		});
		// Installation without a token; device and session with the installation's, signed.
		expect(bunq.calls[0]!.headers['X-Bunq-Client-Authentication']).toBeUndefined();
		expect(bunq.calls[2]!.headers['X-Bunq-Client-Authentication']).toBe('inst');
		expect(bunq.calls[2]!.headers['X-Bunq-Client-Signature']).toBeTruthy();

		const { accounts, context: after } = await client.accounts(context);
		expect(accounts).toEqual([{ id: 11, name: 'Principal', iban: null, active: true }]);
		expect(after.sessionToken).toBe('ses2');
		expect(kept).toEqual(['ses1', 'ses2']);

		const page = await client.payments(after, 11);
		expect(page.payments.map((p) => p.id)).toEqual([5]);
		expect(page.older).toBe(true);
		expect((await client.payments(after, 11, 5)).older).toBe(false);
		expect(bunq.calls.at(-1)!.path).toContain('older_id=5');
	});

	test('its address set, another app’s kept and an old one of Seilide’s replaced; then taken off', async () => {
		const bunq = fakeBunq();
		const client = bunqClient({ base: 'https://bunq.test/v1', fetch: bunq.fetch });
		let context = await client.connect('clave-buena-de-bunq-123');
		const ours = 'https://seilide.test/api/bancos/bunq/';
		context = await client.notifyTo(context, `${ours}nuevo`, ours);
		expect(bunq.filters()).toEqual([
			{ category: 'PAYMENT', notification_target: 'https://otra-app.example/hook' },
			{ category: 'MUTATION', notification_target: `${ours}nuevo` }
		]);
		await client.notifyTo(context, null, ours);
		expect(bunq.filters()).toEqual([
			{ category: 'PAYMENT', notification_target: 'https://otra-app.example/hook' }
		]);
	});
});
