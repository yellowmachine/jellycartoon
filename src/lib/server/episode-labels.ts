import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, asc, eq, inArray, max } from 'drizzle-orm';
import { LABEL_EVERY_SEC, LABEL_MODEL, OLLAMA_URL } from '$app/env/private';
import { episodeLabels } from '#lib/server/app-settings.ts';
import { db } from '#lib/server/db/index.ts';
import { episode, episodeLabel, labelJob } from '#lib/server/db/schema.ts';
import { framesEvery, probe } from '#lib/server/library/ffmpeg.ts';
import { hlsDir } from '#lib/server/library/paths.ts';
import { log } from '#lib/server/log.ts';

/**
 * Episodes labelled by a vision model in Ollama (OLLAMA_URL, LABEL_MODEL): a frame every
 * LABEL_EVERY_SEC seconds, and for each the labels of Ajustes → Casa it shows. Asked for from a
 * series' selection; one at a time, in the background, in the order of the queue (`label_job`,
 * kept, so a restart goes on with it). What it saw goes in `episode_label`, with the seconds of
 * each frame, and the series' page filters by it. Labelling again replaces it.
 */

export const labellingEnabled = Boolean(OLLAMA_URL);

const EVERY_SEC = Math.max(1, Number(LABEL_EVERY_SEC) || 15);
/** Enough for the model to see the details, as in the tests that went well. */
const FRAME_WIDTH = 1280;
/** One frame: a few seconds on a GPU, the first one also loads the model. */
const FRAME_TIMEOUT_MS = 180_000;

export type LabelJob =
	| { state: 'queued' }
	| { state: 'running'; done: number; total: number }
	| { state: 'failed'; message: string };

let wake: (() => void) | null = null;
/** The one being labelled: its row, how to cancel it, and frames looked at of the total. */
let current: { id: number; abort: AbortController; done: number; total: number } | null = null;

/** Whether «Etiquetar» can be offered: Ollama, and labels to look for. */
export async function labelling() {
	return labellingEnabled && (await episodeLabels()).length > 0;
}

/** For a series' page: how each episode's request goes, if it has one. */
export async function labelJobs(ids: number[]) {
	const jobs = new Map<number, LabelJob>();
	if (!ids.length) return jobs;
	const rows = await db
		.select({
			id: labelJob.id,
			episodeId: labelJob.episodeId,
			state: labelJob.state,
			error: labelJob.error
		})
		.from(labelJob)
		.where(inArray(labelJob.episodeId, ids));
	for (const row of rows) {
		const live = current?.id === row.id ? current : null;
		jobs.set(
			row.episodeId,
			row.state === 'running'
				? { state: 'running', done: live?.done ?? 0, total: live?.total ?? 0 }
				: row.state === 'queued'
					? { state: 'queued' }
					: { state: 'failed', message: row.error ?? 'Error' }
		);
	}
	return jobs;
}

/** For a series' page: the labels each episode has, the most seen first. */
export async function labelsOf(ids: number[]) {
	const labels = new Map<number, { label: string; frames: number }[]>();
	if (!ids.length) return labels;
	const rows = await db
		.select({
			episodeId: episodeLabel.episodeId,
			label: episodeLabel.label,
			times: episodeLabel.times
		})
		.from(episodeLabel)
		.where(inArray(episodeLabel.episodeId, ids));
	for (const row of rows) {
		const list = labels.get(row.episodeId) ?? [];
		list.push({ label: row.label, frames: row.times.length });
		labels.set(row.episodeId, list);
	}
	for (const list of labels.values())
		list.sort((a, b) => b.frames - a.frames || a.label.localeCompare(b.label));
	return labels;
}

/**
 * Into the queue, at its end; nothing for one waiting or being labelled. Their earlier failures
 * go: this is their retry. How many went in.
 */
export async function requestLabels(ids: number[]) {
	if (!ids.length) return 0;
	const added = await db.transaction(async (tx) => {
		const busy = new Set(
			(
				await tx
					.select({ episodeId: labelJob.episodeId })
					.from(labelJob)
					.where(
						and(inArray(labelJob.episodeId, ids), inArray(labelJob.state, ['queued', 'running']))
					)
			).map((r) => r.episodeId)
		);
		const wanted = ids.filter((id) => !busy.has(id));
		if (!wanted.length) return 0;
		await tx
			.delete(labelJob)
			.where(and(inArray(labelJob.episodeId, wanted), eq(labelJob.state, 'failed')));
		const [last] = await tx.select({ position: max(labelJob.position) }).from(labelJob);
		const start = (last?.position ?? 0) + 1;
		await tx
			.insert(labelJob)
			.values(wanted.map((episodeId, i) => ({ episodeId, position: start + i })));
		return wanted.length;
	});
	if (added) wake?.();
	return added;
}

/** Takes these out of the queue, if they are waiting, and their failures; the one being made goes on. */
export async function cancelLabels(ids: number[]) {
	if (!ids.length) return 0;
	const removed = await db
		.delete(labelJob)
		.where(and(inArray(labelJob.episodeId, ids), inArray(labelJob.state, ['queued', 'failed'])))
		.returning({ id: labelJob.id });
	return removed.length;
}

/** From the server's start: what a previous run left half done goes back to the queue. */
export async function startLabelling() {
	if (!labellingEnabled) return;
	await db
		.update(labelJob)
		.set({ state: 'queued', startedAt: null })
		.where(eq(labelJob.state, 'running'));
	void (async () => {
		while (true) {
			try {
				if (await labelNext()) continue;
			} catch (error) {
				log.error('etiquetas', 'Fallo inesperado de la cola de etiquetas', { error });
			}
			await new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, 60_000);
				wake = () => {
					clearTimeout(timer);
					resolve();
				};
			});
			wake = null;
		}
	})();
}

/** The first of the queue, labelled; false if there was none. */
async function labelNext() {
	const [job] = await db
		.select()
		.from(labelJob)
		.where(eq(labelJob.state, 'queued'))
		.orderBy(asc(labelJob.position), asc(labelJob.id))
		.limit(1);
	if (!job) return false;
	await db
		.update(labelJob)
		.set({ state: 'running', startedAt: new Date() })
		.where(eq(labelJob.id, job.id));
	const run = { id: job.id, abort: new AbortController(), done: 0, total: 0 };
	current = run;
	try {
		await labelEpisode(job.episodeId, run);
		await db.delete(labelJob).where(eq(labelJob.id, job.id));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await db
			.update(labelJob)
			.set({ state: 'failed', error: message })
			.where(eq(labelJob.id, job.id));
		log.error('etiquetas', 'No se pudo etiquetar el capítulo', {
			episodeId: job.episodeId,
			error
		});
	} finally {
		current = null;
	}
	return true;
}

async function labelEpisode(episodeId: number, run: NonNullable<typeof current>) {
	const labels = await episodeLabels();
	if (!labels.length) throw new Error('No hay etiquetas en Ajustes → Casa');
	const [ep] = await db
		.select({ status: episode.status })
		.from(episode)
		.where(eq(episode.id, episodeId));
	if (!ep || ep.status !== 'ready') throw new Error('El capítulo no está convertido');

	const started = performance.now();
	const signal = run.abort.signal;
	// The converted video: the original may have been deleted (DELETE_SOURCES).
	const input = path.join(hlsDir(episodeId), 'video', 'index.m3u8');
	const dir = await mkdtemp(path.join(tmpdir(), 'etiquetas-'));
	const seen = new Map<string, number[]>();
	try {
		const info = await probe(input, signal, false);
		const frames = await framesEvery(input, info, dir, {
			everySec: EVERY_SEC,
			width: FRAME_WIDTH,
			signal
		});
		if (!frames.length) throw new Error('ffmpeg no sacó ningún fotograma');
		run.total = frames.length;
		for (const [i, file] of frames.entries()) {
			const image = (await readFile(file)).toString('base64');
			for (const label of await labelFrame(image, labels, signal)) {
				const times = seen.get(label) ?? [];
				times.push(i * EVERY_SEC);
				seen.set(label, times);
			}
			await rm(file, { force: true });
			run.done++;
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}

	await db.transaction(async (tx) => {
		await tx.delete(episodeLabel).where(eq(episodeLabel.episodeId, episodeId));
		if (seen.size)
			await tx
				.insert(episodeLabel)
				.values([...seen].map(([label, times]) => ({ episodeId, label, times })));
	});
	log.info(
		'etiquetas',
		`Capítulo ${episodeId} etiquetado: ${[...seen.keys()].join(', ') || 'ninguna etiqueta'}`,
		{
			episodeId,
			frames: run.total,
			model: LABEL_MODEL,
			labels: Object.fromEntries([...seen].map(([label, times]) => [label, times.length])),
			ms: Math.round(performance.now() - started)
		}
	);
}

/**
 * The labels one frame shows, among `labels`: with Ollama's structured outputs, so the answer can
 * only be those (https://docs.ollama.com/capabilities/structured-outputs).
 */
async function labelFrame(image: string, labels: string[], signal: AbortSignal) {
	const res = await fetch(`${OLLAMA_URL!.replace(/\/+$/, '')}/api/chat`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: LABEL_MODEL,
			stream: false,
			messages: [
				{
					role: 'user',
					content:
						'Analiza esta imagen y responde con las etiquetas de esta lista que se vean en ella: ' +
						`[${labels.join(', ')}]. Solo las que se vean; ninguna si no se ve ninguna.`,
					images: [image]
				}
			],
			format: {
				type: 'object',
				properties: {
					etiquetas: { type: 'array', items: { type: 'string', enum: labels } }
				},
				required: ['etiquetas']
			},
			// The most likely answer, not a creative one.
			options: { temperature: 0 }
		}),
		signal: AbortSignal.any([AbortSignal.timeout(FRAME_TIMEOUT_MS), signal])
	}).catch((err) => {
		throw new Error(`No se pudo hablar con Ollama: ${err instanceof Error ? err.message : err}`);
	});
	const body = await res.json().catch(() => null);
	if (!res.ok) throw new Error(`Ollama: ${body?.error ?? res.statusText}`);
	let answer: { etiquetas?: unknown };
	try {
		answer = JSON.parse(body?.message?.content ?? '');
	} catch {
		throw new Error(`Ollama no respondió JSON: ${String(body?.message?.content).slice(0, 200)}`);
	}
	const wanted = new Set(labels);
	return [
		...new Set(
			(Array.isArray(answer.etiquetas) ? answer.etiquetas : []).filter(
				(l): l is string => typeof l === 'string' && wanted.has(l)
			)
		)
	];
}
