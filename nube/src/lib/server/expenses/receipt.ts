import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { desc, inArray, sql } from 'drizzle-orm';
import type { ExpenseDraft } from 'comun/expenses.ts';
import { expense } from '#lib/server/db/schema.ts';
import { openRouterKey } from '#lib/server/family-settings.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { completeJson, VISION_MODEL } from '#lib/server/openrouter.ts';
import { today } from '#lib/server/fridge.ts';
import { putFile, removeFile, renameFile } from '#lib/server/storage.ts';
import { BILL_PROMPT, BILL_SCHEMA, billDraftFromAnswer, redact } from './bill-parse.ts';
import { draftFromAnswer, RECEIPT_SCHEMA, receiptPrompt } from './receipt-parse.ts';

const run = promisify(execFile);

/**
 * A receipt's photo read by a vision model (jellycartoon's #194), and a bill's PDF by its text
 * (#232), with the family's OpenRouter key (#253; no Ollama in the cloud). The file waits in the
 * family's storage (storage.ts) until the expense is saved; one never saved is left there, under
 * `tmp-`.
 */

/** In the family's storage. */
export const AREA = 'gastos';

/** At most, in the prompt: the most used, so it does not grow with every shop ever. */
const KNOWN_STORES = 50;

/**
 * The shops the family has bought at, most used first: from receipts and written by hand, not the
 * fixed ones' or voice's names («Alquiler», «Cena»).
 */
async function knownStores(k: Kitchen) {
	const rows = await k.run((tx) =>
		tx
			.select({ store: expense.store })
			.from(expense)
			.where(inArray(expense.source, ['ticket', 'mano']))
			.groupBy(expense.store)
			.orderBy(desc(sql`count(*)`), expense.store)
			.limit(KNOWN_STORES)
	);
	return rows.map((r) => r.store);
}

/** Whether the family's receipts can be read: with its OpenRouter key (Ajustes → IA). */
export async function canReadReceipts(k: Kitchen) {
	return Boolean(await openRouterKey(k));
}

export async function readReceipt(k: Kitchen, image: Buffer): Promise<ExpenseDraft> {
	const receipt = await keepWaiting(k, image, 'jpg');
	const prompt = receiptPrompt(await knownStores(k).catch(() => []));
	const answer = await read(k, {
		prompt,
		schema: RECEIPT_SCHEMA,
		image: image.toString('base64'),
		...TICKET
	});
	const draft = draftFromAnswer(answer, today());
	return { ...draft, receipt, readBy: 'openrouter', bill: null };
}

/**
 * A bill (#232), as a PDF or a photo. A PDF is read by its text, as the power companies make
 * them: exact, without a vision model, and without what identifies the house (`redact`). Only
 * one without text (scanned) goes as its first page's image.
 */
export async function readBill(k: Kitchen, file: Buffer, isPdf: boolean): Promise<ExpenseDraft> {
	const receipt = await keepWaiting(k, file, isPdf ? 'pdf' : 'jpg');
	let text = '';
	let image: Buffer | null = isPdf ? null : file;
	if (isPdf)
		await withPdf(file, async (pdf) => {
			text = await pdfText(pdf);
			if (text.length < MIN_PDF_TEXT) {
				image = await pdfImage(pdf);
				text = '';
			}
		});
	const answer = await read(k, {
		prompt: text
			? `${BILL_PROMPT}\n\nEl texto de la factura:\n\n${redact(text)}`
			: `${BILL_PROMPT} Está en la imagen.`,
		schema: BILL_SCHEMA,
		image: (image as Buffer | null)?.toString('base64') ?? null,
		...BILL
	});
	const draft = billDraftFromAnswer(answer, today());
	return { ...draft, receipt, readBy: 'openrouter' };
}

/** Less than this in a PDF: scanned, with no text to read. */
const MIN_PDF_TEXT = 100;

/** What a page sends to be read, kept in the family's storage until its expense is saved. */
async function keepWaiting(k: Kitchen, file: Buffer, extension: 'jpg' | 'pdf') {
	const name = `tmp-${randomUUID()}.${extension}`;
	await putFile(
		k.familyId,
		AREA,
		name,
		file,
		extension === 'pdf' ? 'application/pdf' : 'image/jpeg'
	);
	return name;
}

/** The PDF in a folder of its own for a moment: poppler's tools read files. */
async function withPdf(file: Buffer, work: (pdf: string) => Promise<void>) {
	const dir = await mkdtemp(path.join(tmpdir(), 'factura-'));
	try {
		const pdf = path.join(dir, 'factura.pdf');
		await writeFile(pdf, file);
		await work(pdf);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/** A PDF's text, with its columns where they are (poppler's pdftotext); none, empty. */
async function pdfText(file: string) {
	try {
		const { stdout } = await run('pdftotext', ['-layout', '-l', '4', file, '-'], {
			timeout: 30_000,
			maxBuffer: 4 * 1024 * 1024
		});
		return stdout.trim();
	} catch (err) {
		console.warn('[gastos] No se pudo sacar el texto del PDF', err);
		return '';
	}
}

/** A PDF's first page as a JPEG, to read it as a photo (poppler's pdftoppm). */
async function pdfImage(file: string) {
	const { stdout } = await run(
		'pdftoppm',
		['-jpeg', '-r', '150', '-f', '1', '-l', '1', '-singlefile', file],
		{ timeout: 30_000, maxBuffer: 16 * 1024 * 1024, encoding: 'buffer' }
	);
	return stdout;
}

const TICKET = {
	label: 'Leer un ticket',
	system: 'Lees tickets de compra y devuelves lo que pone, sin inventar.',
	name: 'ticket'
};

const BILL = {
	label: 'Leer una factura',
	system: 'Lees facturas de suministros de casa y devuelves lo que pone, sin inventar.',
	name: 'factura'
};

interface Reading {
	system: string;
	prompt: string;
	schema: Record<string, unknown>;
	/** The photo, in base64; without it, the prompt is all. */
	image: string | null;
	name: string;
	/** For the spending's line. */
	label: string;
}

/** A photo, by the vision model; a bill's text alone, by the usual one. */
async function read(k: Kitchen, reading: Reading) {
	const apiKey = await openRouterKey(k);
	if (!apiKey)
		throw new Error(
			'Para leer tickets y facturas hace falta la clave de OpenRouter (Ajustes → IA)'
		);
	return completeJson<unknown>({
		apiKey,
		label: reading.label,
		system: reading.system,
		prompt: reading.image
			? [
					{ type: 'text', text: reading.prompt },
					{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${reading.image}` } }
				]
			: reading.prompt,
		name: reading.name,
		schema: reading.schema,
		model: reading.image ? VISION_MODEL : undefined,
		timeoutMs: 120_000,
		maxTokens: 8_192
	});
}

/** A receipt or bill read and waiting (`tmp-…`), kept with its expense: its file's new name. */
export async function keepReceipt(k: Kitchen, receipt: string, expenseId: number) {
	const waiting = /^tmp-[\w-]+\.(jpg|pdf)$/.exec(receipt);
	if (!waiting) return null;
	const kept = `${expenseId}.${waiting[1]}`;
	return (await renameFile(k.familyId, AREA, receipt, kept)) ? kept : null;
}

export async function removeReceipt(k: Kitchen, file: string | null) {
	if (file) await removeFile(k.familyId, AREA, path.basename(file)).catch(() => {});
}
