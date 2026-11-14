import { randomBytes } from 'node:crypto';
import {
	and,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	lte,
	ne,
	notExists,
	notInArray,
	sql
} from 'drizzle-orm';
import { bankAccount, bankLink, bankPayment, expense } from '../db/schema.ts';
import type { AnyDb } from '../family-scope.ts';
import type { Kitchen } from '../fridge.ts';
import { hashOf } from '../house-key-scope.ts';
import { plainText } from '../expenses/plain.ts';
import { addMonths, isCategory, type ExpenseCategory, type ExpenseInput } from 'comun/expenses.ts';
import {
	BunqError,
	type BunqAccount,
	type BunqClient,
	type BunqContext,
	type BunqPayment
} from './bunq-api.ts';

/**
 * Dinero's bank (#502): bunq, by an API key of each adult's own. Their accounts chosen bring each
 * payment in as one more expense of the family, already accepted (source `banco`), unless it is
 * of one already there: a receipt or bill of the same amount within a few days, or a fixed one of
 * that name, to which it is joined instead, so that nothing counts twice. Only money going out to
 * others: income, moving money between their own accounts and refunds stay out for now.
 *
 * bunq calls Seilide on every movement (/api/bancos/bunq/<token>), taken only as «something
 * happened»: the new payments are then asked for with the session, so a forged call brings nothing
 * and a lost one is caught every hour. The connection is theirs; what it brings, the family's.
 */

export const PROVIDER = 'bunq';
/** The name of their connection among their secrets: a BunqContext, as JSON. */
const SECRET = 'bunq';
/** A receipt and its card payment: a few days apart at most. */
const SAME_DAYS = 3;
/** A fixed one and its charge: the bank may take it some days before or after its day. */
const FIXED_DAYS = 10;
/** How far back «Traer pagos anteriores» goes. */
export const MAX_HISTORY_MONTHS = 12;
/** Pages walked back at most, in an hour's look or a history: 200 each. */
const MAX_PAGES = 30;
/** Between two pages: bunq allows only a few GETs every few seconds. */
const PAGE_GAP_MS = 1_100;

export interface BankAccountView {
	id: number;
	name: string;
	iban: string | null;
	chosen: boolean;
	closed: boolean;
}

export interface BankStatus {
	hooked: boolean;
	problem: string | null;
	lastSyncAt: Date | null;
	accounts: BankAccountView[];
}

/** What «Traer pagos anteriores» would do, or did. */
export interface HistoryCount {
	/** Payments out to others in those months. */
	payments: number;
	/** Of them, new expenses. */
	added: number;
	/** Of them, joined to an expense already there. */
	joined: number;
	/** Of them, already brought in before. */
	known: number;
	/** What the new ones add up to, in cents. */
	addedTotal: number;
}

export interface BunqDeps {
	asUser: <T>(userId: string, fn: (tx: AnyDb) => Promise<T>) => Promise<T>;
	secrets: {
		get: (userId: string, name: string) => Promise<string | null>;
		set: (userId: string, name: string, text: string | null) => Promise<void>;
	};
	kitchenOf: (userId: string) => Promise<Kitchen>;
	/** A client that keeps a session opened again (`onSession`). */
	client: (onSession: (context: BunqContext) => Promise<void>) => BunqClient;
	/** The address bunq is to call with that token; null, none (an http ORIGIN, in development). */
	hookUrl: (token: string) => string | null;
	/** What all of Seilide's addresses start with, to tell them from another app's. */
	hookPrefix: string;
	/**
	 * A new expense: expenses.ts's addExpense, as source `banco`. `live`, a payment just made: it
	 * sets off the family's «compra» rules (#451), as a receipt saved; not one of months before.
	 */
	addExpense: (k: Kitchen, input: ExpenseInput, userId: string, live: boolean) => Promise<number>;
	sleep?: (ms: number) => Promise<void>;
	today: () => string;
	dayOf: (moment: Date) => string;
}

/** Whether a payment is money going out to others: what Dinero brings in. */
export function isSpending(p: BunqPayment, ownIbans: Set<string>) {
	if (p.amount >= 0) return false;
	const iban = p.counterpartyIban?.replace(/\s+/g, '').toUpperCase();
	return !(iban && ownIbans.has(iban));
}

/** The shop as bunq names the other side; else what the payment says. */
export const storeOf = (p: BunqPayment) =>
	(p.counterpartyName ?? p.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'bunq';

/**
 * The category of the family's expense whose shop is this one, or within its name («Mercadona» in
 * «MERCADONA VALENCIA»): the newest first. «Otros», none.
 */
export function categoryOf(
	store: string,
	known: { store: string; category: string }[]
): ExpenseCategory {
	const name = plainText(store).trim();
	const same = known.find((k) => plainText(k.store).trim() === name);
	const within =
		same ??
		known.find((k) => {
			const other = plainText(k.store).trim();
			return other.length >= 4 && name.includes(other);
		});
	return within && isCategory(within.category) ? within.category : 'Otros';
}

const addDays = (day: string, by: number) => {
	const d = new Date(`${day}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + by);
	return d.toISOString().slice(0, 10);
};

const daysApart = (a: string, b: string) =>
	Math.abs(new Date(`${a}T12:00:00Z`).getTime() - new Date(`${b}T12:00:00Z`).getTime()) /
	86_400_000;

/** «Luz» in «Iberdrola Luz», or the other way round. */
const sameName = (a: string, b: string) => {
	const x = plainText(a).trim();
	const y = plainText(b).trim();
	return x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x));
};

/** Why bunq said no, in Spanish, for the page. */
export function problemOf(err: unknown) {
	if (err instanceof BunqError) {
		if (err.status === 401 || err.status === 403)
			return 'bunq no acepta la conexión. Vuelve a conectar con una clave de API nueva.';
		if (err.status === 429) return 'bunq pide esperar un poco. Prueba dentro de un rato.';
		return `bunq ha respondido: ${err.message}`;
	}
	return 'No se ha podido hablar con bunq. Prueba dentro de un rato.';
}

export function bunqBank(deps: BunqDeps) {
	const { asUser, secrets, kitchenOf, hookUrl, hookPrefix, today, dayOf } = deps;
	const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

	async function contextOf(userId: string): Promise<BunqContext | null> {
		const raw = await secrets.get(userId, SECRET);
		if (!raw) return null;
		try {
			return JSON.parse(raw) as BunqContext;
		} catch {
			return null;
		}
	}

	const keep = (userId: string) => (context: BunqContext) =>
		secrets.set(userId, SECRET, JSON.stringify(context));

	const clientOf = (userId: string) => deps.client(keep(userId));

	const accountsOf = (userId: string) =>
		asUser(userId, (tx) =>
			tx
				.select()
				.from(bankAccount)
				.where(eq(bankAccount.userId, userId))
				.orderBy(bankAccount.accountId)
		);

	async function setProblem(userId: string, problem: string | null) {
		await asUser(userId, (tx) =>
			tx
				.update(bankLink)
				.set(problem ? { problem } : { problem: null, lastSyncAt: new Date() })
				.where(eq(bankLink.userId, userId))
		);
	}

	/** Their accounts as bunq has them now: new ones, not chosen; those closed there, so. */
	async function saveAccounts(userId: string, accounts: BunqAccount[]) {
		await asUser(userId, async (tx) => {
			for (const a of accounts)
				await tx
					.insert(bankAccount)
					.values({ userId, accountId: a.id, name: a.name, iban: a.iban, closed: !a.active })
					.onConflictDoUpdate({
						target: [bankAccount.userId, bankAccount.accountId],
						set: {
							name: a.name,
							iban: a.iban,
							closed: !a.active,
							...(a.active ? {} : { chosen: false })
						}
					});
			const ids = accounts.map((a) => a.id);
			// Gone from bunq's list altogether: closed too.
			await tx
				.update(bankAccount)
				.set({ closed: true, chosen: false })
				.where(
					and(
						eq(bankAccount.userId, userId),
						ids.length ? notInArray(bankAccount.accountId, ids) : undefined
					)
				);
		});
	}

	/** The newest payment's id of an account now: from it on, they come in. */
	async function newestId(context: BunqContext, client: BunqClient, accountId: number) {
		const { payments, context: ctx } = await client.payments(context, accountId);
		return { id: payments[0]?.id ?? 0, context: ctx };
	}

	/** Each of the user's own IBANs, chosen or not: money between them is not spending. */
	async function ownIbans(userId: string) {
		const rows = await accountsOf(userId);
		return new Set(rows.flatMap((r) => (r.iban ? [r.iban.replace(/\s+/g, '').toUpperCase()] : [])));
	}

	/** The family's shops and their categories, the newest first: to put a new one's. */
	const knownStores = (k: Kitchen) =>
		k.run((tx) =>
			tx
				.select({ store: expense.store, category: expense.category })
				.from(expense)
				.where(ne(expense.source, 'banco'))
				.orderBy(desc(expense.date), desc(expense.id))
				.limit(2000)
		);

	/** Not yet joined to a payment of the bank. */
	const unjoined = (tx: AnyDb) =>
		notExists(
			tx
				.select({ one: sql`1` })
				.from(bankPayment)
				.where(eq(bankPayment.expenseId, expense.id))
		);

	/**
	 * The expense already there that this payment is of, if any: a receipt, a bill or one written
	 * by hand of the same amount within a few days (the same day first); else a fixed one of its
	 * name within some days of its day. Not one already joined to another payment.
	 */
	async function matchOf(k: Kitchen, day: string, store: string, total: number) {
		return k.run(async (tx) => {
			const same = await tx
				.select({ id: expense.id, date: expense.date })
				.from(expense)
				.where(
					and(
						eq(expense.total, total),
						ne(expense.source, 'banco'),
						gte(expense.date, addDays(day, -SAME_DAYS)),
						lte(expense.date, addDays(day, SAME_DAYS)),
						unjoined(tx)
					)
				);
			if (same.length)
				return {
					id: same.sort((a, b) => daysApart(a.date, day) - daysApart(b.date, day))[0]!.id,
					fixedTotal: null
				};
			const fixed = await tx
				.select({
					id: expense.id,
					date: expense.date,
					store: expense.store,
					total: expense.total,
					receipt: expense.receipt
				})
				.from(expense)
				.where(
					and(
						isNotNull(expense.recurringId),
						gte(expense.date, addDays(day, -FIXED_DAYS)),
						lte(expense.date, addDays(day, FIXED_DAYS)),
						unjoined(tx)
					)
				);
			const named = fixed
				.filter((f) => sameName(f.store, store))
				.sort((a, b) => daysApart(a.date, day) - daysApart(b.date, day))[0];
			if (!named) return null;
			// What the bank charged is what it cost, unless its receipt already said (#501).
			return { id: named.id, fixedTotal: named.receipt || named.total === total ? null : total };
		});
	}

	/** Already brought in, of these payments. */
	async function knownIds(k: Kitchen, ids: number[]) {
		if (!ids.length) return new Set<number>();
		const rows = await k.run((tx) =>
			tx
				.select({ id: bankPayment.paymentId })
				.from(bankPayment)
				.where(and(eq(bankPayment.provider, PROVIDER), inArray(bankPayment.paymentId, ids)))
		);
		return new Set(rows.map((r) => r.id));
	}

	/**
	 * One payment into Dinero: claimed first (twice at once, once), then joined or added. Its
	 * outcome; `known`, it was already in.
	 */
	async function bringIn(
		k: Kitchen,
		userId: string,
		p: BunqPayment,
		stores: { store: string; category: string }[],
		/** Just paid (bunq's call, the hourly look): its «compra» rules; not from «Traer pagos anteriores». */
		live: boolean
	): Promise<'added' | 'joined' | 'known'> {
		const [claimed] = await k.run((tx) =>
			tx
				.insert(bankPayment)
				.values({ familyId: k.familyId, provider: PROVIDER, paymentId: p.id, userId })
				.onConflictDoNothing()
				.returning({ id: bankPayment.id })
		);
		if (!claimed) return 'known';
		const day = dayOf(p.created);
		const store = storeOf(p);
		const total = -p.amount;
		try {
			const match = await matchOf(k, day, store, total);
			if (match) {
				await k.run(async (tx) => {
					if (match.fixedTotal !== null)
						await tx
							.update(expense)
							.set({ total: match.fixedTotal })
							.where(eq(expense.id, match.id));
					await tx
						.update(bankPayment)
						.set({ expenseId: match.id, joined: true })
						.where(eq(bankPayment.id, claimed.id));
				});
				return 'joined';
			}
			const id = await deps.addExpense(
				k,
				{ date: day, store, category: categoryOf(store, stores), total, lines: [] },
				userId,
				live
			);
			await k.run((tx) =>
				tx.update(bankPayment).set({ expenseId: id }).where(eq(bankPayment.id, claimed.id))
			);
			return 'added';
		} catch (err) {
			// Let go of, to be tried again the next time.
			await k.run((tx) => tx.delete(bankPayment).where(eq(bankPayment.id, claimed.id)));
			throw err;
		}
	}

	/** Their chosen accounts' payments since each one's newest looked at, into Dinero: the oldest first. */
	async function syncNow(userId: string) {
		let context = await contextOf(userId);
		if (!context) return;
		const client = clientOf(userId);
		try {
			const fresh = await client.accounts(context);
			context = fresh.context;
			await saveAccounts(userId, fresh.accounts);
			const accounts = (await accountsOf(userId)).filter((a) => a.chosen && !a.closed);
			if (!accounts.length) return void (await setProblem(userId, null));
			const k = await kitchenOf(userId);
			const own = await ownIbans(userId);
			const stores = await knownStores(k);
			for (const account of accounts) {
				const since = account.lastPaymentId ?? 0;
				const found: BunqPayment[] = [];
				let older: number | null = null;
				for (let page = 0; page < MAX_PAGES; page++) {
					if (page) await sleep(PAGE_GAP_MS);
					const got = await client.payments(context, account.accountId, older);
					context = got.context;
					const newer = got.payments.filter((p) => p.id > since);
					found.push(...newer);
					if (!got.older || newer.length < got.payments.length || !got.payments.length) break;
					older = got.payments.at(-1)!.id;
				}
				if (!found.length) continue;
				found.sort((a, b) => a.id - b.id);
				let last = since;
				for (const p of found) {
					if (isSpending(p, own)) await bringIn(k, userId, p, stores, true);
					last = p.id;
					// Kept as it goes: a failure halfway does not bring the first ones twice.
					await asUser(userId, (tx) =>
						tx
							.update(bankAccount)
							.set({ lastPaymentId: last })
							.where(
								and(eq(bankAccount.userId, userId), eq(bankAccount.accountId, account.accountId))
							)
					);
				}
			}
			await setProblem(userId, null);
		} catch (err) {
			console.warn('[banco] No se han podido traer los pagos de bunq', {
				userId,
				error: err instanceof Error ? err.message : String(err)
			});
			await setProblem(userId, problemOf(err));
		}
	}

	/** One look at a time for each person; asked again while looking, once more after. */
	const running = new Map<string, Promise<void>>();
	const again = new Set<string>();
	function sync(userId: string): Promise<void> {
		const now = running.get(userId);
		if (now) {
			again.add(userId);
			return now;
		}
		const run = (async () => {
			try {
				do {
					again.delete(userId);
					await syncNow(userId);
				} while (again.has(userId));
			} finally {
				running.delete(userId);
			}
		})();
		running.set(userId, run);
		return run;
	}

	/** Their chosen accounts' payments from that month's first day on, the oldest first. */
	async function paymentsSince(userId: string, month: string) {
		let context = await contextOf(userId);
		if (!context) return null;
		const client = clientOf(userId);
		const from = `${month}-01`;
		const own = await ownIbans(userId);
		const accounts = (await accountsOf(userId)).filter((a) => a.chosen && !a.closed);
		const found: BunqPayment[] = [];
		for (const account of accounts) {
			let older: number | null = null;
			for (let page = 0; page < MAX_PAGES; page++) {
				if (page || found.length) await sleep(PAGE_GAP_MS);
				const got = await client.payments(context, account.accountId, older);
				context = got.context;
				const inRange = got.payments.filter((p) => dayOf(p.created) >= from);
				found.push(...inRange.filter((p) => isSpending(p, own)));
				if (!got.older || inRange.length < got.payments.length || !got.payments.length) break;
				older = got.payments.at(-1)!.id;
			}
		}
		return found.sort((a, b) => a.id - b.id);
	}

	/** The months «Traer pagos anteriores» may start from: this one and the 11 before. */
	const historyMonth = (month: string) => {
		const now = today().slice(0, 7);
		return /^\d{4}-\d{2}$/.test(month) &&
			month <= now &&
			month >= addMonths(now, -(MAX_HISTORY_MONTHS - 1))
			? month
			: null;
	};

	return {
		/** Their connection, for the page; null, none. Their accounts as bunq has them now, if it answers. */
		async statusOf(userId: string): Promise<BankStatus | null> {
			const [link] = await asUser(userId, (tx) =>
				tx.select().from(bankLink).where(eq(bankLink.userId, userId))
			);
			if (!link) return null;
			const accounts = await accountsOf(userId);
			return {
				hooked: link.hooked,
				problem: link.problem,
				lastSyncAt: link.lastSyncAt,
				accounts: accounts
					.filter((a) => !a.closed || a.chosen)
					.map((a) => ({
						id: a.accountId,
						name: a.name,
						iban: a.iban,
						chosen: a.chosen,
						closed: a.closed
					}))
			};
		},

		/**
		 * Connected with that API key: bunq's installation, device and session; their accounts, none
		 * chosen yet; and the address bunq calls. Why not, in Spanish; null, done.
		 */
		async connect(userId: string, apiKey: string): Promise<string | null> {
			const key = apiKey.trim();
			if (!/^[\w-]{20,200}$/.test(key)) return 'Pega la clave de API de bunq tal cual';
			let context: BunqContext;
			const client = clientOf(userId);
			try {
				context = await client.connect(key);
			} catch (err) {
				if (err instanceof BunqError && [400, 401, 403].includes(err.status))
					return 'bunq no acepta esa clave. Comprueba que la has copiado entera y que sigue activa.';
				return problemOf(err);
			}
			await keep(userId)(context);
			const token = randomBytes(32).toString('base64url');
			let accounts: BunqAccount[];
			let hooked = false;
			try {
				const got = await client.accounts(context);
				context = got.context;
				accounts = got.accounts;
				const url = hookUrl(token);
				if (url) {
					context = await client.notifyTo(context, url, hookPrefix);
					hooked = true;
				}
			} catch (err) {
				await secrets.set(userId, SECRET, null);
				return problemOf(err);
			}
			await asUser(userId, async (tx) => {
				await tx.delete(bankAccount).where(eq(bankAccount.userId, userId));
				await tx
					.insert(bankLink)
					.values({
						userId,
						provider: PROVIDER,
						bankUserId: context.bankUserId!,
						hookHash: hashOf(token),
						hooked,
						lastSyncAt: new Date()
					})
					.onConflictDoUpdate({
						target: bankLink.userId,
						set: {
							bankUserId: context.bankUserId!,
							hookHash: hashOf(token),
							hooked,
							problem: null,
							lastSyncAt: new Date()
						}
					});
			});
			await saveAccounts(userId, accounts);
			return null;
		},

		/**
		 * The accounts that bring their payments in: those newly chosen, from their newest payment on
		 * (the ones before, by «Traer pagos anteriores»). Why not, in Spanish; null, done.
		 */
		async choose(userId: string, ids: number[]): Promise<string | null> {
			let context = await contextOf(userId);
			if (!context) return 'Conecta bunq primero';
			const accounts = await accountsOf(userId);
			const client = clientOf(userId);
			try {
				for (const a of accounts) {
					const chosen = ids.includes(a.accountId) && !a.closed;
					if (chosen === a.chosen) continue;
					let lastPaymentId = a.lastPaymentId;
					if (chosen) {
						const newest = await newestId(context, client, a.accountId);
						context = newest.context;
						lastPaymentId = newest.id;
					}
					await asUser(userId, (tx) =>
						tx
							.update(bankAccount)
							.set({ chosen, lastPaymentId })
							.where(and(eq(bankAccount.userId, userId), eq(bankAccount.accountId, a.accountId)))
					);
				}
			} catch (err) {
				return problemOf(err);
			}
			return null;
		},

		/**
		 * Disconnected: the address bunq called, taken off there (if it answers); the key, the
		 * session and the accounts, forgotten here. What it brought in stays in Dinero.
		 */
		async disconnect(userId: string) {
			const context = await contextOf(userId);
			if (context)
				await clientOf(userId)
					.notifyTo(context, null, hookPrefix)
					.catch((err) =>
						console.warn('[banco] No se ha podido quitar el aviso en bunq', String(err))
					);
			await secrets.set(userId, SECRET, null);
			await asUser(userId, async (tx) => {
				await tx.delete(bankAccount).where(eq(bankAccount.userId, userId));
				await tx.delete(bankLink).where(eq(bankLink.userId, userId));
			});
		},

		sync,

		/** Every hour, for each of the family's people with a bank: what bunq's calls missed. */
		async syncAll(userIds: string[]) {
			for (const userId of userIds) {
				const [link] = await asUser(userId, (tx) =>
					tx.select({ userId: bankLink.userId }).from(bankLink).where(eq(bankLink.userId, userId))
				);
				if (link) await sync(userId);
			}
		},

		/** «Traer pagos anteriores»: what it would bring in, without bringing anything. Null, not connected or a wrong month. */
		async previewHistory(userId: string, month: string): Promise<HistoryCount | string | null> {
			const from = historyMonth(month);
			if (!from) return null;
			try {
				const payments = await paymentsSince(userId, from);
				if (!payments) return null;
				const k = await kitchenOf(userId);
				const known = await knownIds(
					k,
					payments.map((p) => p.id)
				);
				const count: HistoryCount = {
					payments: payments.length,
					added: 0,
					joined: 0,
					known: 0,
					addedTotal: 0
				};
				// Two payments of one receipt are not both joined to it: as bringing them in would.
				const taken = new Set<number>();
				for (const p of payments) {
					if (known.has(p.id)) {
						count.known++;
						continue;
					}
					const match = await matchOf(k, dayOf(p.created), storeOf(p), -p.amount);
					if (match && !taken.has(match.id)) {
						taken.add(match.id);
						count.joined++;
					} else {
						count.added++;
						count.addedTotal += -p.amount;
					}
				}
				return count;
			} catch (err) {
				return problemOf(err);
			}
		},

		/** «Traer pagos anteriores», done: from that month's first day on. */
		async importHistory(userId: string, month: string): Promise<HistoryCount | string | null> {
			const from = historyMonth(month);
			if (!from) return null;
			try {
				const payments = await paymentsSince(userId, from);
				if (!payments) return null;
				const k = await kitchenOf(userId);
				const stores = await knownStores(k);
				const count: HistoryCount = {
					payments: payments.length,
					added: 0,
					joined: 0,
					known: 0,
					addedTotal: 0
				};
				for (const p of payments) {
					const outcome = await bringIn(k, userId, p, stores, false);
					count[outcome]++;
					if (outcome === 'added') count.addedTotal += -p.amount;
				}
				return count;
			} catch (err) {
				return problemOf(err);
			}
		}
	};
}

export type BunqBank = ReturnType<typeof bunqBank>;
