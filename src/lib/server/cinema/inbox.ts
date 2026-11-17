import type { ChildProcess } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, readdir, readFile, rename, rm, rmdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { getAppSetting, setAppSetting } from '#lib/server/app-settings.ts';
import { probe, probeDuration, run } from '#lib/server/library/ffmpeg.ts';
import { scanFilms } from '#lib/server/library/nightly.ts';
import { cinemaRoot } from '#lib/server/library/paths.ts';
import { VIDEO_EXTENSIONS } from '#lib/server/library/scan.ts';
import { log } from '#lib/server/log.ts';
import { mpvEnabled, watchRemote } from './mpv.ts';
import {
	cpuTicks,
	encodeArgs,
	frameRate,
	INBOX,
	isTemp,
	othersCores,
	processTicks,
	progressSeconds,
	sameLength,
	settled,
	targetOf,
	tempOf,
	type Seen
} from './inbox-plan.ts';

/**
 * Cine's inbox: the films just ripped with MakeMKV are left in `entrada/` inside Cine's folder;
 * each one, once copied, is encoded to HEVC (x265, much smaller at the same look) and moved to
 * Cine, where the scan catalogues it. One at a time, only while nobody uses the living room:
 * at the lowest priority (CPU and disk), frozen (not lost) while the salon's mpv plays something
 * or the rest of the PC works (a game, the TV view, a conversion), and going on 10 minutes after
 * that ends. Already HEVC, or not an mkv: moved as it is. The original is deleted once the new
 * one is checked (as long as it). The 01:00 suspend freezes it with everything else; it goes on
 * when the PC wakes. Restarting the app starts the film over: x265 can't resume a file.
 */

/** Without use for this long, it goes on. */
const MARGIN_MS = 10 * 60_000;
/** How often it looks at what the PC does, and at the folder. */
const TICK_MS = 10_000;
const LOOK_MS = 60_000;
/** The rest of the PC above this, on average over a minute, or above `BURST` right now: in use. */
const BUSY_CORES = 0.5;
const BURST_CORES = 2;
const SAMPLES = 6;
const DONE_KEPT = 20;
/** Longer than the scan's own wait for files still being copied (cinema/scan.ts). */
const SCAN_AFTER_MS = 90_000;

export const inboxDir = cinemaRoot ? path.join(cinemaRoot, INBOX) : null;

interface Current {
	name: string;
	durationSec: number | null;
	doneSec: number;
	startedAt: number;
	/** Encoding time before the last freeze, and since when it runs again (null while frozen). */
	activeMs: number;
	runningSince: number | null;
	child: ChildProcess | null;
	abort: AbortController;
	cancelled: boolean;
}

interface Failure {
	size: number;
	error: string;
	at: string;
}

interface Done {
	name: string;
	encoded: boolean;
	fromBytes: number;
	toBytes: number;
	at: string;
}

let started = false;
/** Cine's folder can't be written (the compose still mounts it read-only), or another problem. */
let problem: string | null = null;
let paused = false;
let current: Current | null = null;
/** Every video in the inbox at the last look, with its size and date. */
let files: { name: string; size: number; mtimeMs: number; ready: boolean }[] = [];
const seenBefore = new Map<string, Seen>();
let failed: Record<string, Failure> = {};
const done: Done[] = [];
/** The last time the living room was in use, and why. */
let lastUseAt = 0;
let lastUse: string | null = null;
const samples: number[] = [];
let lastTicks: { busy: number; total: number; ours: number } | null = null;
let cpus = 1;
let unwatchMpv: (() => void) | null = null;
let mpvPlaying = false;
let wake: (() => void) | null = null;

/** A game was opened from the app (Steam, RetroDECK): in use from now. */
export function noteSalonUse(why: string) {
	lastUseAt = Date.now();
	lastUse = why;
}

export async function startInbox() {
	if (started || !inboxDir) return;
	started = true;
	paused = (await getAppSetting('cinema_inbox_paused')) === 'true';
	failed = JSON.parse((await getAppSetting('cinema_inbox_failed')) ?? '{}');
	try {
		await mkdir(inboxDir, { recursive: true });
		await access(inboxDir, constants.W_OK);
	} catch (error) {
		problem =
			'No se puede escribir en la carpeta de Cine: actualiza compose.prod.yaml (ahora la monta con permiso de escritura) y haz up -d.';
		log.warn('cine', 'La entrada de Cine no se puede usar', { error });
		return;
	}
	cpus = (await readFile('/proc/stat', 'utf8')).split('\n').filter((l) => /^cpu\d/.test(l)).length;
	void loop();
}

async function loop() {
	let lastLook = 0;
	for (;;) {
		try {
			if (Date.now() - lastLook >= LOOK_MS) {
				await look();
				lastLook = Date.now();
			}
			const working = current !== null || files.some((f) => f.ready && !failed[f.name]);
			if (working) {
				await measure();
				watchMpv(true);
				await decide();
			} else {
				watchMpv(false);
				samples.length = 0;
				lastTicks = null;
			}
		} catch (error) {
			log.error('cine', 'Falló la entrada de Cine', { error });
		}
		await new Promise<void>((resolve) => {
			wake = resolve;
			setTimeout(resolve, TICK_MS).unref();
		});
	}
}

/** Looks at the folder right away (a button in Gestión). */
function wakeInbox() {
	wake?.();
}

/** Every video in the inbox: their sizes, and whether each is done being copied. */
async function look() {
	const found: { name: string; size: number; mtimeMs: number }[] = [];
	async function walk(dir: string) {
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (isTemp(entry.name) && current === null) {
				// Half made when the app stopped: started over.
				await rm(full, { force: true });
				continue;
			}
			if (entry.name.startsWith('.')) continue;
			if (entry.isDirectory()) await walk(full);
			else if (VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
				const info = await stat(full);
				found.push({
					name: path.relative(inboxDir!, full),
					size: info.size,
					mtimeMs: info.mtimeMs
				});
			}
		}
	}
	await walk(inboxDir!);
	const now = Date.now();
	files = found
		.sort((a, b) => a.mtimeMs - b.mtimeMs)
		.map((f) => ({ ...f, ready: settled(f, seenBefore.get(f.name), now) }));
	seenBefore.clear();
	for (const f of found) seenBefore.set(f.name, { size: f.size, mtimeMs: f.mtimeMs });
	// A failed one copied again (another size): tried again. One no longer there: forgotten.
	let changed = false;
	for (const [name, failure] of Object.entries(failed)) {
		const file = found.find((f) => f.name === name);
		if (!file || file.size !== failure.size) {
			delete failed[name];
			changed = true;
		}
	}
	if (changed) await saveFailed();
}

/** What the rest of the PC used since the last look, without our ffmpeg. */
async function measure() {
	const { busy, total } = cpuTicks(await readFile('/proc/stat', 'utf8'));
	let ours = lastTicks?.ours ?? 0;
	const pid = current?.child?.pid;
	if (pid !== undefined) {
		const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => null);
		if (stat) ours = processTicks(stat);
	}
	const now = { busy, total, ours };
	// A new ffmpeg counts from zero: its first look only sets where it starts.
	if (lastTicks && ours >= lastTicks.ours) {
		samples.push(othersCores(lastTicks, now, cpus));
		if (samples.length > SAMPLES) samples.shift();
	}
	lastTicks = now;
}

function watchMpv(on: boolean) {
	if (!mpvEnabled) return;
	if (on && !unwatchMpv) unwatchMpv = watchRemote((state) => (mpvPlaying = state.active));
	if (!on && unwatchMpv) {
		unwatchMpv();
		unwatchMpv = null;
		mpvPlaying = false;
	}
}

/** In use now, and why; null if not. */
function useNow() {
	if (mpvPlaying) return 'algo en el salón';
	const last = samples.at(-1) ?? 0;
	const average = samples.reduce((a, b) => a + b, 0) / (samples.length || 1);
	if (last > BURST_CORES || average > BUSY_CORES)
		return `el ordenador trabaja (${(samples.length ? Math.max(last, average) : 0).toFixed(1)} núcleos)`;
	return null;
}

/** Whether it may encode now: not paused, a minute measured and 10 minutes without use. */
function mayRun() {
	return !paused && samples.length >= SAMPLES && Date.now() - lastUseAt >= MARGIN_MS;
}

async function decide() {
	const use = useNow();
	if (use) noteSalonUse(use);
	if (current) {
		freeze(!mayRun());
		return;
	}
	if (!mayRun()) return;
	const next = files.find((f) => f.ready && !failed[f.name]);
	if (next) void handle(next);
}

function freeze(on: boolean) {
	if (!current?.child) return;
	const frozen = current.runningSince === null;
	if (on === frozen) return;
	current.child.kill(on ? 'SIGSTOP' : 'SIGCONT');
	if (on) {
		current.activeMs += Date.now() - current.runningSince!;
		current.runningSince = null;
		log.info('cine', `Entrada: en pausa mientras se usa el salón (${lastUse})`, {
			file: current.name
		});
	} else current.runningSince = Date.now();
}

const exists = (file: string) =>
	access(file).then(
		() => true,
		() => false
	);

async function handle(file: { name: string; size: number }) {
	const input = path.join(inboxDir!, file.name);
	current = {
		name: file.name,
		durationSec: null,
		doneSec: 0,
		startedAt: Date.now(),
		activeMs: 0,
		runningSince: Date.now(),
		child: null,
		abort: new AbortController(),
		cancelled: false
	};
	const job = current;
	const temp = tempOf(input);
	try {
		const info = await probe(input, undefined, false);
		const video = info.streams.find(
			(s) => s.codec_type === 'video' && !s.disposition?.attached_pic
		);
		if (!video) throw new Error('No tiene vídeo');
		const encode = path.extname(input).toLowerCase() === '.mkv' && video.codec_name !== 'hevc';
		const relative = targetOf(file.name, encode);
		const target = path.join(cinemaRoot!, relative);
		if (await exists(target)) throw new Error(`Ya hay un «${relative}» en Cine`);
		if (encode) {
			job.durationSec = Number(info.format.duration) || null;
			const fps = frameRate(video.avg_frame_rate) ?? 24;
			log.info('cine', `Entrada: codificando ${file.name}`);
			// SCHED_IDLE and the idle disk class: only what nobody else wants.
			await run('chrt', ['-i', '0', 'ionice', '-c3', 'ffmpeg', ...encodeArgs(input, temp)], {
				pausable: false,
				signal: job.abort.signal,
				onSpawn: (child) => {
					job.child = child;
					// Frozen if the salon was taken while it was probing.
					if (!mayRun()) freeze(true);
				},
				onStdout: (chunk) => (job.doneSec = progressSeconds(chunk, fps) ?? job.doneSec)
			});
			const length = await probeDuration(temp);
			if (!sameLength(job.durationSec, length))
				throw new Error(
					`El nuevo no dura lo mismo (${Math.round(job.durationSec ?? 0)} s el original, ${Math.round(length ?? 0)} s el nuevo)`
				);
			if (await exists(target)) throw new Error(`Ya hay un «${relative}» en Cine`);
			await mkdir(path.dirname(target), { recursive: true });
			await rename(temp, target);
			await rm(input);
		} else {
			await mkdir(path.dirname(target), { recursive: true });
			await rename(input, target);
		}
		const toBytes = (await stat(target)).size;
		done.unshift({
			name: relative,
			encoded: encode,
			fromBytes: file.size,
			toBytes,
			at: new Date().toISOString()
		});
		done.length = Math.min(done.length, DONE_KEPT);
		log.info('cine', `Entrada: ${relative} ya está en Cine`, {
			encoded: encode,
			fromBytes: file.size,
			toBytes
		});
		files = files.filter((f) => f.name !== file.name);
		seenBefore.delete(file.name);
		await removeEmptyFolders(path.dirname(input));
		// Catalogued: after a while, because the scan leaves files modified in the last minute for
		// later (still being copied), and the new one was just written.
		setTimeout(
			() =>
				void scanFilms().catch((error) =>
					log.error('cine', 'Falló el escaneo tras la entrada', { error })
				),
			SCAN_AFTER_MS
		).unref();
	} catch (error) {
		await rm(temp, { force: true });
		const message = job.cancelled
			? 'Cancelado a mano'
			: (error instanceof Error ? error.message : String(error)).split('\n').slice(0, 3).join(' ');
		failed[file.name] = { size: file.size, error: message, at: new Date().toISOString() };
		await saveFailed();
		log.error('cine', `Entrada: no se pudo pasar ${file.name} a Cine`, { error });
	} finally {
		current = null;
		lastTicks = null;
		samples.length = 0;
		wakeInbox();
	}
}

/** The film's folder in the inbox, once empty (not the inbox itself). */
async function removeEmptyFolders(dir: string) {
	while (dir.startsWith(inboxDir! + path.sep)) {
		if ((await readdir(dir)).length) return;
		await rmdir(dir);
		dir = path.dirname(dir);
	}
}

async function saveFailed() {
	await setAppSetting(
		'cinema_inbox_failed',
		Object.keys(failed).length ? JSON.stringify(failed) : null
	);
}

export async function setInboxPaused(value: boolean) {
	paused = value;
	await setAppSetting('cinema_inbox_paused', value ? 'true' : null);
	if (current) freeze(!mayRun());
	wakeInbox();
}

/** Stops the one being encoded; set aside until «Reintentar». */
export function cancelInboxCurrent() {
	if (!current) return;
	current.cancelled = true;
	// Frozen, it only dies with SIGKILL, which is what the abort sends.
	current.abort.abort();
}

export async function retryInbox(name: string) {
	delete failed[name];
	await saveFailed();
	wakeInbox();
}

/** For Gestión → Entrada. */
export function inboxStatus() {
	const job = current;
	const activeSec = job
		? (job.activeMs + (job.runningSince === null ? 0 : Date.now() - job.runningSince)) / 1000
		: 0;
	const resumesAt = lastUseAt + MARGIN_MS;
	return {
		enabled: inboxDir !== null,
		folder: INBOX,
		problem,
		paused,
		/** In use, and until when it waits. */
		waiting: !paused && Date.now() < resumesAt ? { why: lastUse, until: resumesAt } : null,
		current: job && {
			name: job.name,
			durationSec: job.durationSec,
			doneSec: job.doneSec,
			activeSec,
			frozen: job.runningSince === null,
			/** How many seconds of film each second of encoding. */
			speed: activeSec > 30 ? job.doneSec / activeSec : null
		},
		queue: files
			.filter((f) => f.name !== job?.name && !failed[f.name])
			.map((f) => ({ name: f.name, size: f.size, copying: !f.ready })),
		failed: Object.entries(failed).map(([name, f]) => ({ name, ...f })),
		done
	};
}
