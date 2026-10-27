import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { desc, inArray, sql } from 'drizzle-orm';
import { LABEL_MODEL, OLLAMA_URL } from '$app/env/private';
import type { ExpenseDraft } from '#lib/expenses.ts';
import { openRouterConfig, visionModel } from '#lib/server/app-settings.ts';
import { db } from '#lib/server/db/index.ts';
import { expense } from '#lib/server/db/schema.ts';
import { dataRoot } from '#lib/server/library/paths.ts';
import { log } from '#lib/server/log.ts';
import { completeJson } from '#lib/server/openrouter.ts';
import { today } from '#lib/server/playlist.ts';
import { BILL_PROMPT, BILL_SCHEMA, billDraftFromAnswer, redact } from './bill-parse.ts';
import { draftFromAnswer, RECEIPT_SCHEMA, receiptPrompt } from './receipt-parse.ts';

const run = promisify(execFile);

/**
 * A receipt's photo read by a vision model (#194), and a bill's PDF by its text (#232): OpenRouter's first, a few seconds; Ollama's, in
 * the house, when there is no key or it fails. Ollama came first until 2026-10-26: free, but it
 * unloads its model after 5 minutes idle, and loading it again took «un buen rato» for each receipt
 * on its own. The photo waits in DATA_DIR/gastos until the expense is saved; one never saved is
 * left there, under `tmp-`.
 */

export const receiptsDir = path.join(dataRoot, 'gastos');

/** The model loaded the first time, and a long receipt: well over a frame's. */
const OLLAMA_TIMEOUT_MS = 180_000;

/** At most, in the prompt: the most used, so it does not grow with every shop ever. */
const KNOWN_STORES = 50;

/**
 * The shops the house has bought at, most used first: from receipts and written by hand, not the
 * fixed ones' or voice's names («Alquiler», «Cena»).
 */
async function knownStores() {
	const rows = await db
		.select({ store: expense.store })
		.from(expense)
		.where(inArray(expense.source, ['ticket', 'mano']))
		.groupBy(expense.store)
		.orderBy(desc(sql`count(*)`), expense.store)
		.limit(KNOWN_STORES);
	return rows.map((r) => r.store);
}

/** Whether a receipt can be read here: by Ollama or by OpenRouter. */
export async function canReadReceipts() {
	return Boolean(OLLAMA_URL) || Boolean((await openRouterConfig()).apiKey);
}

export async function readReceipt(image: Buffer, userId: string): Promise<ExpenseDraft> {
	const receipt = await keepWaiting(image, 'jpg');
	const prompt = receiptPrompt(await knownStores().catch(() => []));
	const started = Date.now();
	const { answer, readBy } = await readWith(
		{ prompt, schema: RECEIPT_SCHEMA, image: image.toString('base64'), ...TICKET },
		userId
	);
	const draft = draftFromAnswer(answer, today());
	log.info(
		'gastos',
		`Ticket leído por ${readBy} en ${Math.round((Date.now() - started) / 1000)} s`,
		{
			store: draft.store,
			lines: draft.lines.length
		}
	);
	return { ...draft, receipt, readBy, bill: null };
}

/**
 * A bill (#232), as a PDF or a photo. A PDF is read by its text, as the power companies make
 * them: exact, without a vision model, and without what identifies the house (`redact`). Only
 * one without text (scanned) goes as its first page's image.
 */
export async function readBill(
	file: Buffer,
	isPdf: boolean,
	userId: string
): Promise<ExpenseDraft> {
	const receipt = await keepWaiting(file, isPdf ? 'pdf' : 'jpg');
	let text = isPdf ? await pdfText(path.join(receiptsDir, receipt)) : '';
	const image = !isPdf
		? file
		: text.length < MIN_PDF_TEXT
			? await pdfImage(path.join(receiptsDir, receipt))
			: null;
	if (image) text = '';
	const started = Date.now();
	const { answer, readBy } = await readWith(
		{
			prompt: text
				? `${BILL_PROMPT}\n\nEl texto de la factura:\n\n${redact(text)}`
				: `${BILL_PROMPT} Está en la imagen.`,
			schema: BILL_SCHEMA,
			image: image?.toString('base64') ?? null,
			...BILL
		},
		userId
	);
	const draft = billDraftFromAnswer(answer, today());
	log.info(
		'gastos',
		`Factura leída por ${readBy} (${text ? 'texto del PDF' : 'imagen'}) en ${Math.round((Date.now() - started) / 1000)} s`,
		{ store: draft.store, kind: draft.bill.kind }
	);
	return { ...draft, receipt, readBy };
}

/** Less than this in a PDF: scanned, with no text to read. */
const MIN_PDF_TEXT = 100;

/** What a page sends to be read, kept in DATA_DIR/gastos until its expense is saved. */
async function keepWaiting(file: Buffer, extension: 'jpg' | 'pdf') {
	await mkdir(receiptsDir, { recursive: true });
	const name = `tmp-${randomUUID()}.${extension}`;
	await writeFile(path.join(receiptsDir, name), file);
	return name;
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
		log.warn('gastos', 'No se pudo sacar el texto del PDF', {
			error: err instanceof Error ? err.message : String(err)
		});
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
	system: 'Lees tickets de compra y devuelves lo que pone, sin inventar.',
	name: 'ticket',
	label: 'Ticket de un gasto'
};

const BILL = {
	system: 'Lees facturas de suministros de casa y devuelves lo que pone, sin inventar.',
	name: 'factura',
	label: 'Factura de un gasto'
};

interface Reading {
	system: string;
	prompt: string;
	schema: Record<string, unknown>;
	/** The photo, in base64; without it, the prompt is all. */
	image: string | null;
	name: string;
	label: string;
}

/** OpenRouter's model first; Ollama's, in the house, without a key or when it fails. */
async function readWith(reading: Reading, userId: string) {
	const hasKey = Boolean((await openRouterConfig()).apiKey);
	try {
		if (!hasKey) throw new Error('sin clave de OpenRouter');
		return { answer: await withOpenRouter(reading, userId), readBy: 'openrouter' as const };
	} catch (err) {
		if (hasKey)
			log.warn('gastos', `OpenRouter no pudo leer: ${reading.label}; se prueba con Ollama`, {
				error: err instanceof Error ? err.message : String(err)
			});
		if (!OLLAMA_URL)
			throw new Error(
				hasKey
					? 'OpenRouter no pudo leerlo, y no hay Ollama (OLLAMA_URL) para probar con él.'
					: 'Para leer tickets y facturas hace falta una clave de OpenRouter u Ollama (OLLAMA_URL).'
			);
		return { answer: await withOllama(reading), readBy: 'ollama' as const };
	}
}

async function withOllama({ prompt, schema, image }: Reading) {
	const res = await fetch(`${OLLAMA_URL!.replace(/\/+$/, '')}/api/chat`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: LABEL_MODEL,
			stream: false,
			messages: [{ role: 'user', content: prompt, ...(image ? { images: [image] } : {}) }],
			format: schema,
			// What is written there, not a creative reading.
			options: { temperature: 0 }
		}),
		signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS)
	});
	const body = await res.json().catch(() => null);
	if (!res.ok) throw new Error(`Ollama: ${body?.error ?? res.statusText}`);
	return JSON.parse(body?.message?.content ?? '');
}

/** A photo, by the vision model of Ajustes; a bill's text alone, by the usual one. */
async function withOpenRouter(reading: Reading, userId: string) {
	return completeJson<unknown>({
		system: reading.system,
		prompt: reading.image
			? [
					{ type: 'text', text: reading.prompt },
					{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${reading.image}` } }
				]
			: reading.prompt,
		name: reading.name,
		label: reading.label,
		details: { userId },
		schema: reading.schema,
		model: reading.image ? await visionModel() : undefined,
		timeoutMs: 120_000,
		maxTokens: 8_192
	});
}

/** A receipt or bill read and waiting (`tmp-…`), kept with its expense: its file's new name. */
export async function keepReceipt(receipt: string, expenseId: number) {
	const waiting = /^tmp-[\w-]+\.(jpg|pdf)$/.exec(receipt);
	if (!waiting) return null;
	const kept = `${expenseId}.${waiting[1]}`;
	try {
		await rename(path.join(receiptsDir, receipt), path.join(receiptsDir, kept));
		return kept;
	} catch {
		return null;
	}
}

export async function removeReceipt(file: string | null) {
	if (file) await unlink(path.join(receiptsDir, path.basename(file))).catch(() => {});
}
