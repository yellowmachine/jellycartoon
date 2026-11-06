import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import { addMonths, dueMonths, lastDue, laterMonth, monthOf } from 'comun/expenses.ts';
import {
	isIncomeCategory,
	MAX_CONCEPT,
	type Income,
	type IncomeInput,
	type RecurringIncome
} from 'comun/income.ts';
import { income, recurringIncome, user } from '#lib/server/db/schema.ts';
import { likeOf, plain } from '#lib/server/expenses/plain.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { putFile, removeFile } from '#lib/server/storage.ts';

/**
 * The family's income (#384), in Dinero: every adult sees and changes all of it, as its expenses.
 * Each with its invoice if there is one, a photo or a PDF in the family's storage. And the fixed
 * ones, as the expenses': added by themselves on their day.
 */

/** In the family's storage. */
export const INCOME_AREA = 'ingresos';

/** An invoice, at most: a scanned PDF of a few pages, or a phone's photo. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** What may be kept, by what it is: its extension and how it is served. */
const KINDS = {
	'application/pdf': { ext: 'pdf', type: 'application/pdf' },
	'image/jpeg': { ext: 'jpg', type: 'image/jpeg' },
	'image/png': { ext: 'png', type: 'image/png' },
	'image/webp': { ext: 'webp', type: 'image/webp' }
} as const;

type Kind = keyof typeof KINDS;

/**
 * What the file is, by its first bytes and not by what the browser says: a PDF, a JPEG, a PNG or
 * a WebP; null, none of them.
 */
export function kindOf(file: Uint8Array): Kind | null {
	const starts = (...bytes: number[]) => bytes.every((b, i) => file[i] === b);
	if (starts(0x25, 0x50, 0x44, 0x46)) return 'application/pdf';
	if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
	if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
	if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...file.slice(8, 12)) === 'WEBP')
		return 'image/webp';
	return null;
}

/** How a kept one is served, by its name. */
export function typeOf(name: string) {
	return Object.values(KINDS).find((k) => name.endsWith(`.${k.ext}`))?.type ?? null;
}

const firstDay = (month: string) => `${month}-01`;
const inMonth = (month: string) =>
	and(gte(income.date, firstDay(month)), lt(income.date, firstDay(addMonths(month, 1))));

export async function monthIncome(k: Kitchen, month: string): Promise<Income[]> {
	const rows = await k.run((tx) =>
		tx
			.select({
				id: income.id,
				date: income.date,
				concept: income.concept,
				category: income.category,
				amount: income.amount,
				document: income.document,
				recurringId: income.recurringId,
				by: user.name
			})
			.from(income)
			.leftJoin(user, eq(user.id, income.userId))
			.where(inMonth(month))
			.orderBy(desc(income.date), desc(income.id))
	);
	return rows.map(({ category, document, recurringId, ...r }) => ({
		...r,
		category: isIncomeCategory(category) ? category : 'Otros',
		document: document ? (document.endsWith('.pdf') ? 'pdf' : 'image') : null,
		fixed: recurringId !== null
	}));
}

/** Those with an invoice kept whose concept has `text`, the newest first: for Papeles (documents.ts). */
export function searchIncomeDocuments(k: Kitchen, text: string, limit: number) {
	return k.run((tx) =>
		tx
			.select({ id: income.id, date: income.date, concept: income.concept, amount: income.amount })
			.from(income)
			.where(
				and(isNotNull(income.document), sql`${plain(income.concept)} like ${plain(likeOf(text))}`)
			)
			.orderBy(desc(income.date), desc(income.id))
			.limit(limit)
	);
}

/** A month's, without them: for Mes, beside its expenses. */
export async function monthIncomeTotal(k: Kitchen, month: string) {
	const [row] = await k.run((tx) =>
		tx
			.select({ total: sql<number>`coalesce(sum(${income.amount}), 0)::int` })
			.from(income)
			.where(inMonth(month))
	);
	return row?.total ?? 0;
}

/** The file kept in `area`, by what it is; its name. Throws if it is not a PDF or a picture. */
export async function keepDocument(k: Kitchen, file: Uint8Array, area = INCOME_AREA) {
	const kind = kindOf(file);
	if (!kind) throw new NotADocument();
	const name = `${randomUUID()}.${KINDS[kind].ext}`;
	await putFile(k.familyId, area, name, file, KINDS[kind].type);
	return name;
}

export class NotADocument extends Error {
	constructor() {
		super('Tiene que ser un PDF o una foto (JPG, PNG o WebP)');
	}
}

async function forgetDocument(k: Kitchen, name: string | null) {
	if (!name) return;
	await removeFile(k.familyId, INCOME_AREA, name).catch((err) =>
		console.warn('[ingresos] No se pudo borrar una factura', String(err))
	);
}

export async function addIncome(k: Kitchen, input: IncomeInput, file: Uint8Array | null) {
	const document = file ? await keepDocument(k, file) : null;
	try {
		const [row] = await k.run((tx) =>
			tx
				.insert(income)
				.values({ familyId: k.familyId, ...input, userId: k.userId, document })
				.returning({ id: income.id })
		);
		return row!.id;
	} catch (err) {
		await forgetDocument(k, document);
		throw err;
	}
}

/**
 * Corrected; with `file`, its invoice changed for that one, and with `dropDocument`, taken away.
 * False if it is no longer there.
 */
export async function updateIncome(
	k: Kitchen,
	id: number,
	input: IncomeInput,
	{ file = null, dropDocument = false }: { file?: Uint8Array | null; dropDocument?: boolean } = {}
) {
	const [before] = await k.run((tx) =>
		tx.select({ document: income.document }).from(income).where(eq(income.id, id))
	);
	if (!before) return false;
	const fresh = file ? await keepDocument(k, file) : null;
	const document = fresh ?? (dropDocument ? null : before.document);
	const [row] = await k.run((tx) =>
		tx
			.update(income)
			.set({ ...input, document })
			.where(eq(income.id, id))
			.returning({ id: income.id })
	);
	if (!row) {
		await forgetDocument(k, fresh);
		return false;
	}
	if (document !== before.document) await forgetDocument(k, before.document);
	return true;
}

export async function deleteIncome(k: Kitchen, id: number) {
	const [gone] = await k.run((tx) =>
		tx.delete(income).where(eq(income.id, id)).returning({ document: income.document })
	);
	await forgetDocument(k, gone?.document ?? null);
	return Boolean(gone);
}

/** Its invoice's name, to show it; null without one (or another family's). */
export async function incomeDocument(k: Kitchen, id: number) {
	const [row] = await k.run((tx) =>
		tx.select({ document: income.document }).from(income).where(eq(income.id, id))
	);
	return row?.document ?? null;
}

export async function recurringIncomes(k: Kitchen): Promise<RecurringIncome[]> {
	const rows = await k.run((tx) =>
		tx
			.select()
			.from(recurringIncome)
			.orderBy(sql`${recurringIncome.month} nulls first`, asc(recurringIncome.day))
	);
	return rows.map((r) => ({
		id: r.id,
		concept: r.concept,
		category: isIncomeCategory(r.category) ? r.category : 'Otros',
		amount: r.amount,
		day: r.day,
		month: r.month
	}));
}

/**
 * A new fixed one starts at its next day to come: the one already gone was likely already written
 * down by hand.
 */
export async function addRecurringIncome(k: Kitchen, r: Omit<RecurringIncome, 'id'>, now: string) {
	await k.run((tx) =>
		tx
			.insert(recurringIncome)
			.values({ ...r, familyId: k.familyId, userId: k.userId, lastMonth: lastDue(r, now) })
	);
}

/** Changed to a day or month already gone, it is not added for it: from the next one. */
export async function updateRecurringIncome(
	k: Kitchen,
	id: number,
	r: Omit<RecurringIncome, 'id'>,
	now: string
) {
	await k.run(async (tx) => {
		const [row] = await tx
			.select({ lastMonth: recurringIncome.lastMonth })
			.from(recurringIncome)
			.where(eq(recurringIncome.id, id));
		if (!row) return;
		const due = lastDue(r, now);
		await tx
			.update(recurringIncome)
			.set({ ...r, lastMonth: row.lastMonth ? laterMonth(row.lastMonth, due) : due })
			.where(eq(recurringIncome.id, id));
	});
}

/**
 * «🔁»: an income already written down made a fixed one, every month or every year from its day
 * (28 at most). It is the first: the next ones, from the next time on. False if it is not there;
 * already one, nothing new.
 */
export async function makeRecurringIncome(
	k: Kitchen,
	incomeId: number,
	yearly: boolean,
	now: string
) {
	return k.run(async (tx) => {
		const [i] = await tx
			.select({
				date: income.date,
				concept: income.concept,
				category: income.category,
				amount: income.amount,
				recurringId: income.recurringId
			})
			.from(income)
			.where(eq(income.id, incomeId));
		if (!i) return false;
		if (i.recurringId !== null) return true;
		const r = {
			concept: i.concept.slice(0, MAX_CONCEPT),
			category: isIncomeCategory(i.category) ? i.category : 'Otros',
			amount: i.amount,
			day: Math.min(28, Number(i.date.slice(8, 10))),
			month: yearly ? Number(i.date.slice(5, 7)) : null
		};
		const [row] = await tx
			.insert(recurringIncome)
			.values({
				...r,
				familyId: k.familyId,
				userId: k.userId,
				lastMonth: laterMonth(monthOf(i.date), lastDue(r, now))
			})
			.returning({ id: recurringIncome.id });
		await tx.update(income).set({ recurringId: row!.id }).where(eq(income.id, incomeId));
		return true;
	});
}

/** The income it already added stays, as received: let go of first, then it goes. */
export async function deleteRecurringIncome(k: Kitchen, id: number) {
	await k.run(async (tx) => {
		await tx.update(income).set({ recurringId: null }).where(eq(income.recurringId, id));
		await tx.delete(recurringIncome).where(eq(recurringIncome.id, id));
	});
}

/**
 * The family's fixed ones whose day has come, added: each month once, also the ones missed while
 * nobody looked. On opening Dinero. Each claimed with its income in one go, so that two pages
 * opened at once add it once and a failure leaves it to the next time.
 */
export async function addDueRecurringIncome(k: Kitchen, now: string) {
	for (const r of await k.run((tx) => tx.select().from(recurringIncome))) {
		let previous = r.lastMonth;
		for (const month of dueMonths(r, r.lastMonth, now)) {
			const claimed = await k.run(async (tx) => {
				const rows = await tx
					.update(recurringIncome)
					.set({ lastMonth: month })
					.where(
						and(
							eq(recurringIncome.id, r.id),
							previous === null
								? sql`${recurringIncome.lastMonth} is null`
								: eq(recurringIncome.lastMonth, previous)
						)
					)
					.returning({ id: recurringIncome.id });
				if (!rows.length) return false;
				await tx.insert(income).values({
					familyId: k.familyId,
					date: `${month}-${String(r.day).padStart(2, '0')}`,
					concept: r.concept,
					category: isIncomeCategory(r.category) ? r.category : 'Otros',
					amount: r.amount,
					userId: r.userId,
					recurringId: r.id
				});
				return true;
			});
			if (!claimed) break;
			previous = month;
		}
	}
}
