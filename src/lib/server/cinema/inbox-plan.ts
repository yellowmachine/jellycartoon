import path from 'node:path';

/**
 * The pure parts of Cine's inbox (inbox.ts): when a file is done being copied, where it goes,
 * how much CPU the rest of the PC uses, and ffmpeg's arguments. Without the database nor
 * SvelteKit, to test them on their own.
 */

/** The folder inside Cine's where new rips are left (MakeMKV's), to be encoded and moved. */
export const INBOX = 'entrada';

/** Unchanged for this long, and the same size as the time before: the copy is done. */
export const SETTLE_MS = 2 * 60_000;

export interface Seen {
	size: number;
	mtimeMs: number;
}

/**
 * Done being copied: modified a while ago and the same size as the look before. Both, because
 * `cp -p` or a copy that keeps the date can leave an old date on a file that is still growing.
 */
export function settled(now: Seen, before: Seen | undefined, at: number) {
	return before !== undefined && before.size === now.size && at - now.mtimeMs >= SETTLE_MS;
}

/**
 * Where it goes in Cine: the same path without `entrada/`. A film in its own folder
 * (`entrada/Alien/title_t00.mkv`) keeps it, as MakeMKV leaves it. Always `.mkv` when encoded.
 */
export function targetOf(relativeInInbox: string, encoded: boolean) {
	const parsed = path.parse(relativeInInbox);
	return encoded ? path.join(parsed.dir, `${parsed.name}.mkv`) : relativeInInbox;
}

/** The half-made file, beside the original and hidden (a dot): the scan and Kodi skip it. */
export function tempOf(absoluteInput: string) {
	const parsed = path.parse(absoluteInput);
	return path.join(parsed.dir, `.${parsed.name}.codificando.mkv`);
}

export const isTemp = (name: string) => name.startsWith('.') && name.endsWith('.codificando.mkv');

/** Whether the encoded file is as long as the original: 1 % or 2 s of margin. */
export function sameLength(original: number | null, encoded: number | null) {
	if (!original || !encoded) return false;
	return Math.abs(original - encoded) <= Math.max(2, original * 0.01);
}

/** The first line of /proc/stat: busy and total ticks of every CPU together. */
export function cpuTicks(procStat: string) {
	const fields = procStat.split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
	// user nice system idle iowait irq softirq steal: idle and iowait are not busy.
	const [user, nice, system, idle, iowait, irq, softirq, steal] = fields;
	const busy = user + nice + system + irq + softirq + (steal || 0);
	return { busy, total: busy + idle + iowait };
}

/** utime + stime of /proc/<pid>/stat: a process's own ticks (with its threads). */
export function processTicks(procPidStat: string) {
	// The name, in brackets, may have spaces: the fields count from after its closing one.
	const after = procPidStat.slice(procPidStat.lastIndexOf(')') + 2).split(' ');
	// utime and stime are fields 14 and 15, so 12 and 13 after the name (field 2) and state (3).
	return Number(after[11]) + Number(after[12]);
}

/**
 * How many CPUs the rest of the PC used between two looks, without our ffmpeg: what it took
 * (busy ticks) minus ours, over the time passed (total ticks per CPU).
 */
export function othersCores(
	before: { busy: number; total: number; ours: number },
	now: { busy: number; total: number; ours: number },
	cpus: number
) {
	const total = now.total - before.total;
	if (total <= 0) return 0;
	const others = now.busy - before.busy - Math.max(0, now.ours - before.ours);
	return Math.max(0, others) / (total / cpus);
}

/**
 * The encode, as /home/miguel/dev/encode.sh did it (x265, CRF 18, medium), keeping all the
 * audio and subtitle tracks, chapters and attachments as they are (the script dropped the
 * subtitles). Progress to stdout, for Gestión.
 */
export function encodeArgs(input: string, output: string) {
	return [
		'-hide_banner',
		'-nostdin',
		'-nostats',
		'-analyzeduration',
		'100M',
		'-probesize',
		'100M',
		'-i',
		input,
		'-map',
		'0:v:0',
		'-map',
		'0:a?',
		'-map',
		'0:s?',
		'-map',
		'0:t?',
		'-c',
		'copy',
		'-c:v:0',
		'libx265',
		'-crf',
		'18',
		'-preset',
		'medium',
		'-x265-params',
		'log-level=error',
		// Many subtitle tracks wait for the video, slow at the start: room for them.
		'-max_muxing_queue_size',
		'4096',
		'-progress',
		'pipe:1',
		'-y',
		output
	];
}

/**
 * Seconds of film done, from ffmpeg's -progress output: its last `frame=` over the video's frame
 * rate. Not its `out_time`, which follows every track and stops where the subtitles do.
 */
export function progressSeconds(chunk: string, fps: number) {
	const all = [...chunk.matchAll(/^frame=(\d+)/gm)];
	return all.length && fps > 0 ? Number(all[all.length - 1][1]) / fps : null;
}

/** ffprobe's `24000/1001` as a number; null if it can't tell. */
export function frameRate(rate: string | undefined) {
	const [num, den] = (rate ?? '').split('/').map(Number);
	return num > 0 && den > 0 ? num / den : null;
}
