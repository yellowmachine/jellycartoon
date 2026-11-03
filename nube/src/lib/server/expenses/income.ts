import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { addMonths } from 'comun/expenses.ts';
import { isIncomeCategory, type Income, type IncomeInput } from 'comun/income.ts';
import { income, user } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { putFile, removeFile } from '#lib/server/storage.ts';

/**
 * The family's income (#384), in Dinero: every adult sees and changes all of it, as its expenses.
 * Each with its invoice if there is one, a photo or a PDF in the family's storage.
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
				by: user.name
			})
			.from(income)
			.leftJoin(user, eq(user.id, income.userId))
			.where(inMonth(month))
			.orderBy(desc(income.date), desc(income.id))
	);
	return rows.map(({ category, document, ...r }) => ({
		...r,
		category: isIncomeCategory(category) ? category : 'Otros',
		document: document ? (document.endsWith('.pdf') ? 'pdf' : 'image') : null
	}));
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

/** The invoice kept, by what it is; its name. Throws if it is not a PDF or a picture. */
async function keepDocument(k: Kitchen, file: Uint8Array) {
	const kind = kindOf(file);
	if (!kind) throw new NotADocument();
	const name = `${randomUUID()}.${KINDS[kind].ext}`;
	await putFile(k.familyId, INCOME_AREA, name, file, KINDS[kind].type);
	return name;
}

export class NotADocument extends Error {
	constructor() {
		super('La factura tiene que ser un PDF o una foto (JPG, PNG o WebP)');
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
