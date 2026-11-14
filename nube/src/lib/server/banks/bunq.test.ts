import { beforeAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import * as schema from '../db/schema.ts';
import {
	bankPayment,
	expense,
	family,
	familyMember,
	recurringExpense,
	user
} from '../db/schema.ts';
import { familyScope, userScope } from '../family-scope.ts';
import type { Kitchen } from '../fridge.ts';
import { bankKeyScope } from './bank-key-scope.ts';
import type { BunqAccount, BunqClient, BunqContext, BunqPayment } from './bunq-api.ts';
import { BunqError } from './bunq-api.ts';
import { bunqBank, categoryOf, isSpending } from './bunq.ts';

/**
 * Dinero's bank (#502) on a real Postgres (PGlite) as the app's role, with a fake bunq: accounts
 * chosen, only money going out to others brought in, joined to what was already there, once, and
 * what was deleted not brought back; the months before, counted first.
 */
const db = drizzle(new PGlite(), { schema });
const withFamily = familyScope(db, { role: 'app_user' });
const asUser = userScope(db, { role: 'app_user' });
const userOfHook = bankKeyScope(db, { role: 'app_user' });

const kitchenOf = async (userId: string): Promise<Kitchen> => {
	const familyId = await withFamily(userId, async (_, m) => m.familyId);
	return { familyId, userId, run: (fn) => withFamily(userId, (tx) => fn(tx)) };
};

const ANA_IBAN = 'NL01BUNQ0000000011';
const SAVINGS_IBAN = 'NL02BUNQ0000000012';

/** bunq as the test wants it: each account's payments, the newest first, in pages of `page`. */
const bunq = {
	accounts: [
		{ id: 11, name: 'Principal', iban: ANA_IBAN, active: true },
		{ id: 12, name: 'Hucha', iban: SAVINGS_IBAN, active: true }
	] as BunqAccount[],
	payments: new Map<number, BunqPayment[]>(),
	page: 2,
	hooked: [] as (string | null)[]
};

const pay = (
	id: number,
	day: string,
	euros: number,
	name: string | null,
	iban: string | null = null
): BunqPayment => ({
	id,
	created: new Date(`${day}T10:00:00Z`),
	amount: Math.round(euros * 100),
	currency: 'EUR',
	description: '',
	counterpartyName: name,
	counterpartyIban: iban,
	type: 'MASTERCARD'
});

function addPayments(account: number, ...ps: BunqPayment[]) {
	const list = [...(bunq.payments.get(account) ?? []), ...ps].sort((a, b) => b.id - a.id);
	bunq.payments.set(account, list);
}

const fakeClient = (): BunqClient => {
	const context = (c: BunqContext) => c;
	return {
		async connect(apiKey) {
			if (apiKey !== 'clave-buena-de-bunq-123') throw new BunqError(400, 'Bad key');
			return {
				apiKey,
				privateKey: 'pk',
				installationToken: 'inst',
				sessionToken: 'ses',
				bankUserId: 99
			};
		},
		async accounts(c) {
			return { accounts: bunq.accounts, context: context(c) };
		},
		async payments(c, accountId, olderThan = null) {
			const all = bunq.payments.get(accountId) ?? [];
			const from = olderThan === null ? all : all.filter((p) => p.id < olderThan);
			const payments = from.slice(0, bunq.page);
			return { payments, older: from.length > payments.length, context: context(c) };
		},
		async notifyTo(c, url) {
			bunq.hooked.push(url);
			return context(c);
		}
	};
};

const kept = new Map<string, string>();
/** Those that set off the «compra» rules: just paid, not of months before. */
const liveStores: string[] = [];
const day = '2026-11-14';

const bank = bunqBank({
	asUser,
	secrets: {
		get: async (u, n) => kept.get(`${u}/${n}`) ?? null,
		set: async (u, n, t) => void (t === null ? kept.delete(`${u}/${n}`) : kept.set(`${u}/${n}`, t))
	},
	kitchenOf,
	client: () => fakeClient(),
	hookUrl: (token) => `https://seilide.test/api/bancos/bunq/${token}`,
	hookPrefix: 'https://seilide.test/api/bancos/bunq/',
	addExpense: async (k, input, userId, live) => {
		if (live) liveStores.push(input.store);
		const { lines: _, ...values } = input;
		const [row] = await k.run((tx) =>
			tx
				.insert(expense)
				.values({ ...values, familyId: k.familyId, source: 'banco', userId })
				.returning({ id: expense.id })
		);
		return row!.id;
	},
	sleep: async () => {},
	today: () => day,
	dayOf: (m) => m.toISOString().slice(0, 10)
});

const person = (id: string) => ({
	id,
	name: id,
	email: `${id}@test.es`,
	createdAt: new Date(),
	updatedAt: new Date()
});

/** The family's expenses as the test compares them. */
const expensesOf = (userId: string) =>
	withFamily(userId, (tx) =>
		tx
			.select({
				id: expense.id,
				date: expense.date,
				store: expense.store,
				category: expense.category,
				total: expense.total,
				source: expense.source
			})
			.from(expense)
			.orderBy(expense.id)
	);

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage, select on all sequences in schema public to app_user`);
	await db.insert(user).values(['ana', 'luis', 'otra'].map(person));
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'B', name: 'Casa B' }
	]);
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' },
		{ userId: 'luis', familyId: 'A', role: 'member' },
		{ userId: 'otra', familyId: 'B', role: 'admin' }
	]);
	// Already in Dinero: a Mercadona receipt and a fixed «Luz».
	const [fixed] = await db
		.insert(recurringExpense)
		.values({ familyId: 'A', name: 'Luz', category: 'Facturas', amount: 6000, day: 5 })
		.returning({ id: recurringExpense.id });
	await db.insert(expense).values([
		{
			familyId: 'A',
			date: '2026-11-01',
			store: 'Mercadona',
			category: 'Supermercado',
			total: 4210,
			source: 'ticket'
		},
		{
			familyId: 'A',
			date: '2026-11-05',
			store: 'Luz',
			category: 'Facturas',
			total: 6000,
			source: 'fijo',
			recurringId: fixed!.id
		}
	]);
});

describe('reglas', () => {
	test('only money going out to others', () => {
		const own = new Set([ANA_IBAN, SAVINGS_IBAN]);
		expect(isSpending(pay(1, day, -5, 'Bar'), own)).toBe(true);
		expect(isSpending(pay(1, day, 1200, 'Nómina'), own)).toBe(false);
		expect(isSpending(pay(1, day, -50, 'Hucha', 'nl02 bunq 0000 0000 12'), own)).toBe(false);
	});

	test('a category by the family’s shop, also within the bank’s name', () => {
		const known = [
			{ store: 'Mercadona', category: 'Supermercado' },
			{ store: 'Bar', category: 'Restaurantes' }
		];
		expect(categoryOf('MERCADONA VALENCIA', known)).toBe('Supermercado');
		expect(categoryOf('bar', known)).toBe('Restaurantes');
		// «Bar» is too short to be found inside another name.
		expect(categoryOf('Barbería Paco', known)).toBe('Otros');
	});
});

describe('bunq en Dinero', () => {
	test('a wrong key is said; a good one connects, no account chosen, bunq told where to call', async () => {
		expect(await bank.connect('ana', 'corta')).toBe('Pega la clave de API de bunq tal cual');
		expect(await bank.connect('ana', 'clave-mala-de-bunq-12345')).toContain('no acepta esa clave');
		expect(await bank.statusOf('ana')).toBeNull();

		expect(await bank.connect('ana', 'clave-buena-de-bunq-123')).toBeNull();
		expect(bunq.hooked.at(-1)).toMatch(/^https:\/\/seilide\.test\/api\/bancos\/bunq\/[\w-]{43}$/);
		expect(await bank.statusOf('ana')).toMatchObject({
			hooked: true,
			problem: null,
			accounts: [
				{ id: 11, name: 'Principal', chosen: false },
				{ id: 12, name: 'Hucha', chosen: false }
			]
		});
		// Only theirs: another adult of the family does not see it.
		expect(await bank.statusOf('luis')).toBeNull();
	});

	test('the address bunq calls says whose it is, and nothing else does', async () => {
		const token = bunq.hooked.at(-1)!.split('/').at(-1)!;
		expect(await userOfHook(token)).toBe('ana');
		expect(await userOfHook('x'.repeat(43))).toBeNull();
		expect(await userOfHook('corto')).toBeNull();
	});

	test('chosen: from its newest payment on, the ones before not brought in', async () => {
		addPayments(11, pay(100, '2026-11-10', -9.99, 'Viejo'));
		expect(await bank.choose('ana', [11])).toBeNull();
		await bank.sync('ana');
		expect((await expensesOf('ana')).map((e) => e.store)).toEqual(['Mercadona', 'Luz']);
	});

	test('new payments: a receipt’s and a fixed one’s joined, others added, income and own moves left out', async () => {
		addPayments(
			11,
			// The Mercadona receipt of the 1st, paid by card on the 2nd.
			pay(101, '2026-11-02', -42.1, 'MERCADONA VALENCIA'),
			// The light, charged on the 8th with the real amount.
			pay(102, '2026-11-08', -63.4, 'Iberdrola Luz'),
			pay(103, '2026-11-12', -12.5, 'MERCADONA VALENCIA'),
			pay(104, '2026-11-12', 1500, 'Nómina'),
			pay(105, '2026-11-13', -100, 'Ana', SAVINGS_IBAN),
			pay(106, '2026-11-13', -3.2, 'Bar Pepe'),
			pay(107, '2026-11-13', -3.2, 'Bar Pepe')
		);
		await bank.sync('ana');
		const all = await expensesOf('ana');
		expect(all.map(({ id: _, ...e }) => e)).toEqual([
			{
				date: '2026-11-01',
				store: 'Mercadona',
				category: 'Supermercado',
				total: 4210,
				source: 'ticket'
			},
			// What the bank charged is what it cost.
			{ date: '2026-11-05', store: 'Luz', category: 'Facturas', total: 6340, source: 'fijo' },
			{
				date: '2026-11-12',
				store: 'MERCADONA VALENCIA',
				category: 'Supermercado',
				total: 1250,
				source: 'banco'
			},
			// Two coffees, two expenses.
			{ date: '2026-11-13', store: 'Bar Pepe', category: 'Otros', total: 320, source: 'banco' },
			{ date: '2026-11-13', store: 'Bar Pepe', category: 'Otros', total: 320, source: 'banco' }
		]);
		expect((await bank.statusOf('ana'))!.lastSyncAt).toBeInstanceOf(Date);
		// The new ones set off the rules; those joined, not (their receipt already did).
		expect(liveStores).toEqual(['MERCADONA VALENCIA', 'Bar Pepe', 'Bar Pepe']);
	});

	test('once: looked at again, nothing doubles; one deleted does not come back', async () => {
		await bank.sync('ana');
		const before = await expensesOf('ana');
		expect(before).toHaveLength(5);
		const coffee = before.at(-1)!;
		await withFamily('ana', (tx) => tx.delete(expense).where(eq(expense.id, coffee.id)));
		await bank.sync('ana');
		// Brought in again from the start: the payment is known.
		await asUser('ana', (tx) =>
			tx
				.update(schema.bankAccount)
				.set({ lastPaymentId: 100 })
				.where(eq(schema.bankAccount.accountId, 11))
		);
		await bank.sync('ana');
		expect(await expensesOf('ana')).toHaveLength(4);
		const rows = await withFamily('ana', (tx) => tx.select().from(bankPayment));
		expect(rows.find((r) => r.paymentId === 107)!.expenseId).toBeNull();
	});

	test('the months before: counted first, then brought in, the known ones left', async () => {
		addPayments(11, pay(90, '2026-10-20', -15, 'Cine'), pay(91, '2026-09-20', -30, 'Gasolinera'));
		const preview = await bank.previewHistory('ana', '2026-10');
		expect(preview).toEqual({ payments: 7, added: 2, joined: 0, known: 5, addedTotal: 2499 });
		// Nothing brought in yet.
		expect(await expensesOf('ana')).toHaveLength(4);
		expect(await bank.previewHistory('ana', '2025-01')).toBeNull();

		expect(await bank.importHistory('ana', '2026-10')).toEqual({
			payments: 7,
			added: 2,
			joined: 0,
			known: 5,
			addedTotal: 2499
		});
		const stores = (await expensesOf('ana')).map((e) => e.store);
		expect(stores).toContain('Cine');
		expect(stores).toContain('Viejo');
		// The months before set off no rule.
		expect(liveStores).not.toContain('Cine');
		expect(stores).not.toContain('Gasolinera');
	});

	test('an account unchosen brings nothing more; what it brought stays', async () => {
		expect(await bank.choose('ana', [])).toBeNull();
		addPayments(11, pay(200, '2026-11-14', -8, 'Kiosko'));
		await bank.sync('ana');
		const stores = (await expensesOf('ana')).map((e) => e.store);
		expect(stores).not.toContain('Kiosko');
		expect(stores).toContain('Cine');
	});

	test('chosen again: from then on, not what came in between', async () => {
		expect(await bank.choose('ana', [11])).toBeNull();
		addPayments(11, pay(201, '2026-11-14', -4, 'Panadería'));
		await bank.sync('ana');
		const stores = (await expensesOf('ana')).map((e) => e.store);
		expect(stores).toContain('Panadería');
		expect(liveStores.at(-1)).toBe('Panadería');
		expect(stores).not.toContain('Kiosko');
	});

	test('an account closed in bunq: no longer chosen nor offered', async () => {
		bunq.accounts = [bunq.accounts[0]!];
		await bank.sync('ana');
		const status = await bank.statusOf('ana');
		expect(status!.accounts.map((a) => a.id)).toEqual([11]);
	});

	test('another family sees none of it', async () => {
		expect(await expensesOf('otra')).toEqual([]);
		expect(await withFamily('otra', (tx) => tx.select().from(bankPayment))).toEqual([]);
	});

	test('disconnected: bunq told, the key forgotten, Dinero as it was', async () => {
		const before = await expensesOf('ana');
		await bank.disconnect('ana');
		expect(bunq.hooked.at(-1)).toBeNull();
		expect(kept.size).toBe(0);
		expect(await bank.statusOf('ana')).toBeNull();
		expect(await expensesOf('ana')).toEqual(before);
	});
});
