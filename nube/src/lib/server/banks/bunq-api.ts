import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';

/**
 * bunq's API (#502, https://doc.bunq.com), with an API key of the person's own: no SDK, only what
 * Seilide needs. Starting once: an RSA key pair (installation), this server as a device bound to
 * its IP (device-server), then a session (session-server), opened again when it expires. Then their
 * accounts, their payments and the address bunq calls on each movement (notification filters).
 *
 * Every request's body is signed with the private key (SHA-256, PKCS #1 v1.5, base64): bunq asks
 * for it only on some, but in production says all, and it costs nothing.
 */

export const BUNQ_API = 'https://api.bunq.com/v1';
export const BUNQ_SANDBOX_API = 'https://public-api.sandbox.bunq.com/v1';
const USER_AGENT = 'Seilide/1.0 (+https://seilide.app)';
const TIMEOUT_MS = 20_000;
/** The most bunq gives in one page. */
export const PAGE = 200;

/** What a connection keeps among the person's secrets, as JSON. */
export interface BunqContext {
	apiKey: string;
	/** PKCS #8, PEM. */
	privateKey: string;
	installationToken: string;
	sessionToken: string | null;
	bankUserId: number | null;
}

export interface BunqAccount {
	id: number;
	name: string;
	iban: string | null;
	active: boolean;
}

export interface BunqPayment {
	id: number;
	/** As bunq says it, in UTC. */
	created: Date;
	/** In cents: negative, money going out. */
	amount: number;
	currency: string;
	description: string;
	counterpartyName: string | null;
	counterpartyIban: string | null;
	type: string | null;
}

/** bunq said no: `status` is its HTTP status, `message` its own error, in English. */
export class BunqError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
	}
}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** A new key pair for an installation. */
export function newKeyPair() {
	return generateKeyPairSync('rsa', {
		modulusLength: 2048,
		publicKeyEncoding: { type: 'spki', format: 'pem' },
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
	});
}

export const signBody = (body: string, privateKey: string) =>
	createSign('sha256').update(body).sign(privateKey, 'base64');

/** bunq's answers: `{"Response": [{"Token": {…}}, {"UserPerson": {…}}]}`. The one named so. */
function part(items: unknown[], ...names: string[]): Record<string, unknown> | null {
	for (const item of items)
		for (const name of names) {
			const value = (item as Record<string, unknown>)?.[name];
			if (value && typeof value === 'object') return value as Record<string, unknown>;
		}
	return null;
}

/** Each object of a list, whatever it is wrapped in (MonetaryAccountBank, Payment…). */
const unwrapped = (items: unknown[]) =>
	items.flatMap((item) => {
		const value = item && typeof item === 'object' ? Object.values(item)[0] : null;
		return value && typeof value === 'object' ? [value as Record<string, unknown>] : [];
	});

/** "-12.34" in cents; null if it is not an amount. */
export function cents(value: unknown): number | null {
	if (typeof value !== 'string' || !/^-?\d+(\.\d{1,2})?$/.test(value)) return null;
	const [whole, fraction = ''] = value.replace('-', '').split('.');
	const n = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
	return value.startsWith('-') ? -n : n;
}

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** `GET /user/{id}/monetary-account`'s accounts. */
export function parseAccounts(items: unknown[]): BunqAccount[] {
	return unwrapped(items).flatMap((a) => {
		if (typeof a.id !== 'number') return [];
		const aliases = Array.isArray(a.alias) ? (a.alias as Record<string, unknown>[]) : [];
		const iban = aliases.find((x) => x.type === 'IBAN');
		return [
			{
				id: a.id,
				name: text(a.description) ?? text(a.display_name) ?? `Cuenta ${a.id}`,
				iban: text(iban?.value),
				active: a.status === 'ACTIVE'
			}
		];
	});
}

/** `GET …/payment`'s payments; those without an id, a date or an amount, left out. */
export function parsePayments(items: unknown[]): BunqPayment[] {
	return unwrapped(items).flatMap((p) => {
		const amount = (p.amount ?? {}) as Record<string, unknown>;
		const value = cents(amount.value);
		// «2026-11-14 10:20:30.123456», in UTC.
		const created =
			typeof p.created === 'string' ? new Date(`${p.created.replace(' ', 'T')}Z`) : null;
		if (typeof p.id !== 'number' || value === null || !created || Number.isNaN(created.getTime()))
			return [];
		const other = (p.counterparty_alias ?? {}) as Record<string, unknown>;
		return [
			{
				id: p.id,
				created,
				amount: value,
				currency: text(amount.currency) ?? 'EUR',
				description: text(p.description) ?? '',
				counterpartyName: text(other.display_name),
				counterpartyIban: text(other.iban),
				type: text(p.type)
			}
		];
	});
}

export interface BunqClientOptions {
	base?: string;
	fetch?: Fetch;
	/** Told when the session was opened again, to keep it. */
	onSession?: (context: BunqContext) => Promise<void>;
}

export function bunqClient({
	base = BUNQ_API,
	fetch: send = fetch,
	onSession
}: BunqClientOptions = {}) {
	async function request(
		method: string,
		path: string,
		{ body, token, privateKey }: { body?: unknown; token?: string; privateKey?: string } = {}
	) {
		const payload = body === undefined ? '' : JSON.stringify(body);
		const headers: Record<string, string> = {
			'Cache-Control': 'no-cache',
			'User-Agent': USER_AGENT,
			'X-Bunq-Language': 'es_ES',
			'X-Bunq-Region': 'es_ES',
			'X-Bunq-Geolocation': '0 0 0 0 000',
			'X-Bunq-Client-Request-Id': randomUUID()
		};
		if (body !== undefined) headers['Content-Type'] = 'application/json';
		if (token) headers['X-Bunq-Client-Authentication'] = token;
		if (privateKey) headers['X-Bunq-Client-Signature'] = signBody(payload, privateKey);
		const url = path.startsWith('/v1/') ? `${base.replace(/\/v1$/, '')}${path}` : `${base}${path}`;
		const res = await send(url, {
			method,
			headers,
			body: body === undefined ? undefined : payload,
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
		const json = (await res.json().catch(() => null)) as {
			Response?: unknown[];
			Pagination?: Record<string, unknown>;
			Error?: { error_description?: string }[];
		} | null;
		if (!res.ok) {
			const message = json?.Error?.[0]?.error_description ?? `HTTP ${res.status}`;
			throw new BunqError(res.status, message);
		}
		return { items: json?.Response ?? [], pagination: json?.Pagination ?? null };
	}

	async function openSession(context: BunqContext) {
		const { items } = await request('POST', '/session-server', {
			body: { secret: context.apiKey },
			token: context.installationToken,
			privateKey: context.privateKey
		});
		const token = part(items, 'Token')?.token;
		const user = part(items, 'UserPerson', 'UserCompany', 'UserApiKey');
		if (typeof token !== 'string' || typeof user?.id !== 'number')
			throw new BunqError(500, 'bunq no ha abierto la sesión');
		const next = { ...context, sessionToken: token, bankUserId: user.id };
		await onSession?.(next);
		return next;
	}

	/** With the session, opened again once if it expired (401). */
	async function withSession(
		context: BunqContext,
		method: string,
		path: (userId: number) => string,
		body?: unknown
	) {
		let ctx = context.sessionToken && context.bankUserId ? context : await openSession(context);
		const ask = () =>
			request(method, path(ctx.bankUserId!), {
				body,
				token: ctx.sessionToken!,
				privateKey: ctx.privateKey
			});
		try {
			return { ...(await ask()), context: ctx };
		} catch (err) {
			if (!(err instanceof BunqError) || err.status !== 401) throw err;
			ctx = await openSession(ctx);
			return { ...(await ask()), context: ctx };
		}
	}

	return {
		/**
		 * Installation, this server as a device (bound to the IP it asks from) and a session: all
		 * that a key needs, done once. Throws BunqError if bunq does not take the key.
		 */
		async connect(apiKey: string): Promise<BunqContext> {
			const { publicKey, privateKey } = newKeyPair();
			const installed = await request('POST', '/installation', {
				body: { client_public_key: publicKey }
			});
			const installationToken = part(installed.items, 'Token')?.token;
			if (typeof installationToken !== 'string')
				throw new BunqError(500, 'bunq no ha dado la instalación');
			await request('POST', '/device-server', {
				body: { description: 'Seilide', secret: apiKey },
				token: installationToken,
				privateKey
			});
			return openSession({
				apiKey,
				privateKey,
				installationToken,
				sessionToken: null,
				bankUserId: null
			});
		},

		async accounts(context: BunqContext) {
			const { items, context: ctx } = await withSession(
				context,
				'GET',
				(u) => `/user/${u}/monetary-account?count=${PAGE}`
			);
			return { accounts: parseAccounts(items), context: ctx };
		},

		/**
		 * A page of an account's payments, the newest first; `olderThan`, those before that id.
		 * `older`: whether there are more before them.
		 */
		async payments(context: BunqContext, accountId: number, olderThan: number | null = null) {
			const {
				items,
				pagination,
				context: ctx
			} = await withSession(
				context,
				'GET',
				(u) =>
					`/user/${u}/monetary-account/${accountId}/payment?count=${PAGE}${olderThan ? `&older_id=${olderThan}` : ''}`
			);
			return {
				payments: parsePayments(items),
				older: typeof pagination?.older_url === 'string',
				context: ctx
			};
		},

		/**
		 * The address bunq calls on every movement of theirs; null, none. bunq replaces the whole
		 * list with what it is sent, so the person's others (another app's) are sent back as they
		 * were: only those starting with `ours` (Seilide's, an old token's too) are replaced.
		 */
		async notifyTo(context: BunqContext, url: string | null, ours: string) {
			const listed = await withSession(context, 'GET', (u) => `/user/${u}/notification-filter-url`);
			const others = unwrapped(listed.items)
				.flatMap((f) =>
					Array.isArray(f.notification_filters)
						? (f.notification_filters as Record<string, unknown>[])
						: [f]
				)
				.filter(
					(f) =>
						typeof f.category === 'string' &&
						typeof f.notification_target === 'string' &&
						!f.notification_target.startsWith(ours)
				)
				.map((f) => ({ category: f.category, notification_target: f.notification_target }));
			const { context: ctx } = await withSession(
				listed.context,
				'POST',
				(u) => `/user/${u}/notification-filter-url`,
				{
					notification_filters: [
						...others,
						...(url ? [{ category: 'MUTATION', notification_target: url }] : [])
					]
				}
			);
			return ctx;
		}
	};
}

export type BunqClient = ReturnType<typeof bunqClient>;
