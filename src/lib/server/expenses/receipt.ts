import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LABEL_MODEL, OLLAMA_URL } from '$app/env/private';
import type { ExpenseDraft } from '#lib/expenses.ts';
import { openRouterConfig, visionModel } from '#lib/server/app-settings.ts';
import { dataRoot } from '#lib/server/library/paths.ts';
import { log } from '#lib/server/log.ts';
import { completeJson } from '#lib/server/openrouter.ts';
import { today } from '#lib/server/playlist.ts';
import { draftFromAnswer, RECEIPT_PROMPT, RECEIPT_SCHEMA } from './receipt-parse.ts';

/**
 * A receipt's photo read by a vision model (#194): Ollama's first, in the house (free, and the
 * photo does not leave it), and OpenRouter's when there is no Ollama or it fails. The photo waits
 * in DATA_DIR/gastos until the expense is saved; one never saved is left there, under `tmp-`.
 */

export const receiptsDir = path.join(dataRoot, 'gastos');

/** The model loaded the first time, and a long receipt: well over a frame's. */
const OLLAMA_TIMEOUT_MS = 180_000;

/** Whether a receipt can be read here: by Ollama or by OpenRouter. */
export async function canReadReceipts() {
	return Boolean(OLLAMA_URL) || Boolean((await openRouterConfig()).apiKey);
}

export async function readReceipt(image: Buffer, userId: string): Promise<ExpenseDraft> {
	await mkdir(receiptsDir, { recursive: true });
	const receipt = `tmp-${randomUUID()}.jpg`;
	await writeFile(path.join(receiptsDir, receipt), image);
	const base64 = image.toString('base64');
	let answer: unknown;
	let readBy: ExpenseDraft['readBy'];
	const started = Date.now();
	try {
		if (!OLLAMA_URL) throw new Error('sin Ollama');
		answer = await withOllama(base64);
		readBy = 'ollama';
	} catch (err) {
		if (OLLAMA_URL)
			log.warn('gastos', 'Ollama no pudo leer el ticket: se prueba con OpenRouter', {
				error: err instanceof Error ? err.message : String(err)
			});
		if (!(await openRouterConfig()).apiKey)
			throw new Error(
				OLLAMA_URL
					? 'Ollama no pudo leer el ticket, y no hay clave de OpenRouter para probar con ella.'
					: 'Para leer tickets hace falta Ollama (OLLAMA_URL) o una clave de OpenRouter.'
			);
		answer = await withOpenRouter(base64, userId);
		readBy = 'openrouter';
	}
	const draft = draftFromAnswer(answer, today());
	log.info(
		'gastos',
		`Ticket leído por ${readBy} en ${Math.round((Date.now() - started) / 1000)} s`,
		{
			store: draft.store,
			lines: draft.lines.length
		}
	);
	return { ...draft, receipt, readBy };
}

async function withOllama(base64: string) {
	const res = await fetch(`${OLLAMA_URL!.replace(/\/+$/, '')}/api/chat`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: LABEL_MODEL,
			stream: false,
			messages: [{ role: 'user', content: RECEIPT_PROMPT, images: [base64] }],
			format: RECEIPT_SCHEMA,
			// What is written there, not a creative reading.
			options: { temperature: 0 }
		}),
		signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS)
	});
	const body = await res.json().catch(() => null);
	if (!res.ok) throw new Error(`Ollama: ${body?.error ?? res.statusText}`);
	return JSON.parse(body?.message?.content ?? '');
}

async function withOpenRouter(base64: string, userId: string) {
	return completeJson<unknown>({
		system: 'Lees tickets de compra y devuelves lo que pone, sin inventar.',
		prompt: [
			{ type: 'text', text: RECEIPT_PROMPT },
			{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } }
		],
		name: 'ticket',
		label: 'Ticket de un gasto',
		details: { userId },
		schema: RECEIPT_SCHEMA,
		model: await visionModel(),
		timeoutMs: 120_000,
		maxTokens: 8_192
	});
}

/** A receipt read and waiting (`tmp-…`), kept with its expense: its file's new name. */
export async function keepReceipt(receipt: string, expenseId: number) {
	if (!/^tmp-[\w-]+\.jpg$/.test(receipt)) return null;
	const kept = `${expenseId}.jpg`;
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
