import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, asc, desc, eq, inArray, isNotNull, max, min, ne, sql } from 'drizzle-orm';
import { LABEL_EVERY_SEC, LABEL_MODEL, OLLAMA_URL } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import {
	episode,
	episodeLabel,
	episodeTitle,
	labelJob,
	labelSet,
	series
} from '#lib/server/db/schema.ts';
import { framesEvery, probe } from '#lib/server/library/ffmpeg.ts';
import { hlsDir } from '#lib/server/library/paths.ts';
import { log } from '#lib/server/log.ts';

/**
 * Episodes labelled by a vision model in Ollama (OLLAMA_URL, LABEL_MODEL): a frame every
 * LABEL_EVERY_SEC seconds, and for each the labels of a set (Ajustes → Casa: «Animales»,
 * «Lugares»…) it shows. Asked for from a series' selection, with a set; one at a time, in the
 * background, in the order of the queue (`label_job`, kept, so a restart goes on with it), and
 * followed in Gestión → Etiquetado. What it saw goes in `episode_label`, with the seconds of each
 * frame, and the series' page filters by it. Labelling again with a set replaces only its labels.
 */

export const labellingEnabled = Boolean(OLLAMA_URL);

const EVERY_SEC = Math.max(1, Number(LABEL_EVERY_SEC) || 15);
/** Enough for the model to see the details, as in the tests that went well. */
const FRAME_WIDTH = 1280;
/** One frame: a few seconds on a GPU, the first one also loads the model. */
const FRAME_TIMEOUT_MS = 180_000;
/** Done ones kept as history, the latest; failures stay until retried or dismissed. */
const KEEP_DONE = 50;
/**
 * The frames the model may fail on (see `ModelFailed`) before the episode counts as failed: a few
 * are left out, more mean something else is wrong.
 */
const MAX_SKIPPED = 0.25;

/**
 * The model could not answer about a frame: with some images the small model repeats a token
 * until Ollama stops it («token repeat limit reached», or with the schema «Unexpected empty
 * grammar stack»), the same with any size or sampling; qwen2.5vl:7b answers. Unlike not reaching
 * Ollama, it is that frame's: it is left out. After it the loaded model may fail with every image
 * until it is unloaded (`unloadModel`).
 */
class ModelFailed extends Error {}

/**
 * Out of Ollama's memory, so that the next request loads it afresh: `keep_alive: 0`, as its FAQ
 * says (https://docs.ollama.com/faq#how-do-i-keep-a-model-loaded-in-memory-or-make-it-unload-immediately).
 */
async function unloadModel() {
	await fetch(`${OLLAMA_URL!.replace(/\/+$/, '')}/api/generate`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ model: LABEL_MODEL, keep_alive: 0 }),
		signal: AbortSignal.timeout(30_000)
	}).catch(() => {});
}

export type LabelJob =
	| { state: 'queued'; set: string }
	| { state: 'running'; set: string; done: number; total: number }
	| { state: 'failed'; set: string; message: string };

let wake: (() => void) | null = null;
/** The one being labelled: its row, how to cancel it, frames looked at of the total, since when. */
let current: {
	id: number;
	abort: AbortController;
	done: number;
	total: number;
	since: number;
} | null = null;

// Sets.

/** «Perro, coche,  perro» → `perro`, `coche`: separated by commas, each once. */
export function parseLabels(text: string) {
	return [
		...new Set(
			text
				.split(',')
				.map((l) => l.trim().toLocaleLowerCase('es').replace(/\s+/g, ' '))
				.filter(Boolean)
		)
	];
}

/** Ajustes → Casa, and the series' selection: every set, by name. */
export async function labelSets() {
	const rows = await db.select().from(labelSet).orderBy(asc(labelSet.name));
	return rows.map((r) => ({ id: r.id, name: r.name, labels: parseLabels(r.labels) }));
}

/** A new set, or one changed. Its labels already seen stay until those episodes are labelled again. */
export async function saveLabelSet(set: { id?: number; name: string; labels: string }) {
	const name = set.name.trim().replace(/\s+/g, ' ');
	const labels = parseLabels(set.labels);
	if (!name) throw new Error('Ponle un nombre al conjunto');
	if (!labels.length) throw new Error('Escribe al menos una etiqueta');
	const [same] = await db
		.select({ id: labelSet.id })
		.from(labelSet)
		.where(and(eq(labelSet.name, name), set.id ? ne(labelSet.id, set.id) : undefined));
	if (same) throw new Error(`Ya hay un conjunto «${name}»`);
	const row = { name, labels: labels.join(', ') };
	if (set.id) await db.update(labelSet).set(row).where(eq(labelSet.id, set.id));
	else await db.insert(labelSet).values(row);
	log.info('ajustes', `Conjunto de etiquetas «${name}» guardado`, { labels });
}

/** Out, with the labels seen with it and its requests. */
export async function deleteLabelSet(id: number) {
	await db.delete(labelSet).where(eq(labelSet.id, id));
	log.info('ajustes', 'Conjunto de etiquetas borrado', { setId: id });
}

/** For «Etiquetar»: the sets to choose from; none, without Ollama or without sets. */
export async function labelling() {
	return labellingEnabled ? (await labelSets()).filter((s) => s.labels.length) : [];
}

// A series' page.

/** How each episode's request goes, if it has one waiting, being made or failed. */
export async function labelJobs(ids: number[]) {
	const jobs = new Map<number, LabelJob>();
	if (!ids.length) return jobs;
	const rows = await db
		.select({
			id: labelJob.id,
			episodeId: labelJob.episodeId,
			state: labelJob.state,
			error: labelJob.error,
			set: labelSet.name
		})
		.from(labelJob)
		.innerJoin(labelSet, eq(labelSet.id, labelJob.setId))
		.where(and(inArray(labelJob.episodeId, ids), ne(labelJob.state, 'done')))
		.orderBy(asc(labelJob.id));
	for (const row of rows) {
		// One waiting or being made says more than an old failure.
		const before = jobs.get(row.episodeId);
		if (before && before.state !== 'failed' && row.state === 'failed') continue;
		const live = current?.id === row.id ? current : null;
		jobs.set(
			row.episodeId,
			row.state === 'running'
				? { state: 'running', set: row.set, done: live?.done ?? 0, total: live?.total ?? 0 }
				: row.state === 'queued'
					? { state: 'queued', set: row.set }
					: { state: 'failed', set: row.set, message: row.error ?? 'Error' }
		);
	}
	return jobs;
}

export interface SeenLabel {
	label: string;
	/** The set it was looked for with. */
	set: string;
	/** Frames it was seen in. */
	frames: number;
}

/** The labels each episode has, by set, the most seen first. */
export async function labelsOf(ids: number[]) {
	const labels = new Map<number, SeenLabel[]>();
	if (!ids.length) return labels;
	const rows = await db
		.select({
			episodeId: episodeLabel.episodeId,
			label: episodeLabel.label,
			set: labelSet.name,
			times: episodeLabel.times
		})
		.from(episodeLabel)
		.innerJoin(labelSet, eq(labelSet.id, episodeLabel.setId))
		.where(inArray(episodeLabel.episodeId, ids));
	for (const row of rows) {
		const list = labels.get(row.episodeId) ?? [];
		list.push({ label: row.label, set: row.set, frames: row.times.length });
		labels.set(row.episodeId, list);
	}
	for (const list of labels.values())
		list.sort(
			(a, b) => a.set.localeCompare(b.set) || b.frames - a.frames || a.label.localeCompare(b.label)
		);
	return labels;
}

/**
 * Into the queue with `setId`, at its end; nothing for one waiting or being labelled with it.
 * Their earlier failures with it go: this is their retry. How many went in.
 */
export async function requestLabels(ids: number[], setId: number) {
	if (!ids.length) return 0;
	const added = await db.transaction(async (tx) => {
		const sameSet = and(inArray(labelJob.episodeId, ids), eq(labelJob.setId, setId));
		const busy = new Set(
			(
				await tx
					.select({ episodeId: labelJob.episodeId })
					.from(labelJob)
					.where(and(sameSet, inArray(labelJob.state, ['queued', 'running'])))
			).map((r) => r.episodeId)
		);
		const wanted = ids.filter((id) => !busy.has(id));
		if (!wanted.length) return 0;
		await tx
			.delete(labelJob)
			.where(
				and(
					inArray(labelJob.episodeId, wanted),
					eq(labelJob.setId, setId),
					eq(labelJob.state, 'failed')
				)
			);
		const [last] = await tx.select({ position: max(labelJob.position) }).from(labelJob);
		const start = (last?.position ?? 0) + 1;
		await tx
			.insert(labelJob)
			.values(wanted.map((episodeId, i) => ({ episodeId, setId, position: start + i })));
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

// Gestión → Etiquetado.

/** The queue in order, the one being made, failures, and the last ones done with what they saw. */
export async function labelQueue() {
	const rows = await db
		.select({
			id: labelJob.id,
			state: labelJob.state,
			error: labelJob.error,
			frames: labelJob.frames,
			finishedAt: labelJob.finishedAt,
			episodeId: labelJob.episodeId,
			setId: labelJob.setId,
			set: labelSet.name,
			seriesId: series.id,
			seriesTitle: series.title,
			season: episode.season,
			number: episode.number,
			title: episodeTitle
		})
		.from(labelJob)
		.innerJoin(labelSet, eq(labelSet.id, labelJob.setId))
		.innerJoin(episode, eq(episode.id, labelJob.episodeId))
		.innerJoin(series, eq(series.id, episode.seriesId))
		.orderBy(asc(labelJob.position), asc(labelJob.id));
	const done = rows
		.filter((r) => r.state === 'done')
		.sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0));
	const seen = await labelsOf(done.map((r) => r.episodeId));
	const items = rows.map((r) => ({
		id: r.id,
		state: r.state,
		set: r.set,
		error: r.error,
		frames: r.frames,
		finishedAt: r.finishedAt,
		title: r.title,
		detail: `${r.seriesTitle} · T${r.season} E${r.number}`,
		href: `/series/${r.seriesId}`,
		// What it saw with that set.
		labels: (seen.get(r.episodeId) ?? []).filter((l) => l.set === r.set)
	}));
	const running = items.find((i) => i.state === 'running');
	const live = running && current?.id === running.id ? current : null;
	return {
		available: labellingEnabled,
		model: LABEL_MODEL,
		everySec: EVERY_SEC,
		running: running
			? {
					...running,
					done: live?.done ?? 0,
					total: live?.total ?? 0,
					elapsedSec: live ? Math.round((Date.now() - live.since) / 1000) : 0
				}
			: null,
		queued: items.filter((i) => i.state === 'queued'),
		failed: items.filter((i) => i.state === 'failed'),
		done: done.map((d) => items.find((i) => i.id === d.id)!)
	};
}

/** One out of the queue; the one being made, stopped (what it had seen is lost). */
export async function cancelJob(jobId: number) {
	if (current?.id === jobId) current.abort.abort();
	else await db.delete(labelJob).where(and(eq(labelJob.id, jobId), eq(labelJob.state, 'queued')));
}

/** Every one waiting; the one being made goes on. */
export async function cancelAllQueued() {
	await db.delete(labelJob).where(eq(labelJob.state, 'queued'));
}

/** Next, after the one being made. */
export async function moveJobFirst(jobId: number) {
	const [first] = await db
		.select({ position: min(labelJob.position) })
		.from(labelJob)
		.where(eq(labelJob.state, 'queued'));
	await db
		.update(labelJob)
		.set({ position: (first?.position ?? 1) - 1 })
		.where(and(eq(labelJob.id, jobId), eq(labelJob.state, 'queued')));
}

/** A failed one (or all, without `jobId`), back to the end of the queue. */
export async function retryFailed(jobId?: number) {
	const [last] = await db.select({ position: max(labelJob.position) }).from(labelJob);
	const failed = await db
		.select({ id: labelJob.id })
		.from(labelJob)
		.where(and(eq(labelJob.state, 'failed'), jobId ? eq(labelJob.id, jobId) : undefined))
		.orderBy(asc(labelJob.position));
	for (const [i, job] of failed.entries())
		await db
			.update(labelJob)
			.set({ state: 'queued', error: null, position: (last?.position ?? 0) + 1 + i })
			.where(eq(labelJob.id, job.id));
	if (failed.length) wake?.();
}

/** A failure out of sight. */
export async function dismissJob(jobId: number) {
	await db.delete(labelJob).where(and(eq(labelJob.id, jobId), eq(labelJob.state, 'failed')));
}

// The queue.

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
	const run = { id: job.id, abort: new AbortController(), done: 0, total: 0, since: Date.now() };
	current = run;
	try {
		await labelEpisode(job.episodeId, job.setId, run);
		await db
			.update(labelJob)
			.set({ state: 'done', frames: run.total, finishedAt: new Date() })
			.where(eq(labelJob.id, job.id));
		await pruneDone();
	} catch (error) {
		if (run.abort.signal.aborted) {
			await db.delete(labelJob).where(eq(labelJob.id, job.id));
			log.info('etiquetas', 'Etiquetado cancelado a medias', { jobId: job.id });
		} else {
			const message = error instanceof Error ? error.message : String(error);
			await db
				.update(labelJob)
				.set({ state: 'failed', error: message, finishedAt: new Date() })
				.where(eq(labelJob.id, job.id));
			log.error('etiquetas', 'No se pudo etiquetar el capítulo', {
				episodeId: job.episodeId,
				error
			});
		}
	} finally {
		current = null;
	}
	return true;
}

async function pruneDone() {
	const keep = db
		.select({ id: labelJob.id })
		.from(labelJob)
		.where(and(eq(labelJob.state, 'done'), isNotNull(labelJob.finishedAt)))
		.orderBy(desc(labelJob.finishedAt))
		.limit(KEEP_DONE);
	await db
		.delete(labelJob)
		.where(and(eq(labelJob.state, 'done'), sql`${labelJob.id} not in (${keep})`));
}

async function labelEpisode(episodeId: number, setId: number, run: NonNullable<typeof current>) {
	const [set] = await db.select().from(labelSet).where(eq(labelSet.id, setId));
	const labels = set ? parseLabels(set.labels) : [];
	if (!labels.length) throw new Error('El conjunto de etiquetas está vacío');
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
	/** Frames the model could not answer about, left out. */
	const skipped: { second: number; error: string }[] = [];
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
			const found = await labelFrame(image, labels, signal).catch(async (error) => {
				if (!(error instanceof ModelFailed)) throw error;
				// Once more with the model loaded afresh; then that frame is left out, and the model
				// unloaded again for the next one.
				await unloadModel();
				return labelFrame(image, labels, signal).catch(async (again) => {
					if (!(again instanceof ModelFailed)) throw again;
					skipped.push({ second: i * EVERY_SEC, error: again.message });
					await unloadModel();
					return [];
				});
			});
			for (const label of found) {
				const times = seen.get(label) ?? [];
				times.push(i * EVERY_SEC);
				seen.set(label, times);
			}
			await rm(file, { force: true });
			run.done++;
		}
		if (skipped.length > frames.length * MAX_SKIPPED)
			throw new Error(
				`El modelo falló en ${skipped.length} de ${frames.length} fotogramas: ${skipped[0]!.error}`
			);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}

	// Only this set's: what other sets saw stays.
	await db.transaction(async (tx) => {
		await tx
			.delete(episodeLabel)
			.where(and(eq(episodeLabel.episodeId, episodeId), eq(episodeLabel.setId, setId)));
		if (seen.size)
			await tx
				.insert(episodeLabel)
				.values([...seen].map(([label, times]) => ({ episodeId, setId, label, times })));
	});
	log.info(
		'etiquetas',
		`Capítulo ${episodeId} etiquetado con «${set!.name}»: ${[...seen.keys()].join(', ') || 'ninguna etiqueta'}`,
		{
			episodeId,
			setId,
			frames: run.total,
			model: LABEL_MODEL,
			labels: Object.fromEntries([...seen].map(([label, times]) => [label, times.length])),
			ms: Math.round(performance.now() - started),
			...(skipped.length ? { skipped } : {})
		}
	);
	if (skipped.length)
		log.warn(
			'etiquetas',
			`Capítulo ${episodeId}: el modelo no pudo con ${skipped.length} de ${run.total} fotogramas, que quedan fuera`,
			{ episodeId, skipped }
		);
}

/**
 * The labels one frame shows, among `labels`: with Ollama's structured outputs
 * (https://docs.ollama.com/capabilities/structured-outputs), a yes or no for each. Asked for the
 * ones it saw, from a list, the small model picked some anyway: a dog in four frames of five with
 * no dog in them; one by one, it said no.
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
						'Mira esta imagen. Para cada etiqueta, responde true solo si se ve claramente en la ' +
						`imagen, y false si no: ${labels.join(', ')}.`,
					images: [image]
				}
			],
			format: {
				type: 'object',
				properties: Object.fromEntries(labels.map((l) => [l, { type: 'boolean' }])),
				required: labels
			},
			// The most likely answer, not a creative one.
			options: { temperature: 0 }
		}),
		signal: AbortSignal.any([AbortSignal.timeout(FRAME_TIMEOUT_MS), signal])
	}).catch((err) => {
		throw new Error(`No se pudo hablar con Ollama: ${err instanceof Error ? err.message : err}`);
	});
	const body = await res.json().catch(() => null);
	// 4xx (a model not pulled, say): for every frame alike. 5xx: this frame's.
	if (!res.ok)
		throw new (res.status >= 500 ? ModelFailed : Error)(`Ollama: ${body?.error ?? res.statusText}`);
	let answer: Record<string, unknown>;
	try {
		answer = JSON.parse(body?.message?.content ?? '');
	} catch {
		throw new ModelFailed(
			`Ollama no respondió JSON: ${String(body?.message?.content).slice(0, 200)}`
		);
	}
	return labels.filter((l) => answer?.[l] === true);
}
