import { spawn, type ChildProcess } from 'node:child_process';
import { AUDIO_LANG, X264_CRF, X264_PRESET } from '$app/env/private';
import { languageLabel, normalizeLang, type AudioTrack } from '#lib/languages.ts';

interface ProbeStream {
	index: number;
	codec_type: 'video' | 'audio' | 'subtitle' | 'data' | 'attachment';
	codec_name?: string;
	profile?: string;
	pix_fmt?: string;
	field_order?: string;
	sample_aspect_ratio?: string;
	channels?: number;
	disposition?: { default?: number; attached_pic?: number };
	tags?: { language?: string };
}

export interface Probe {
	streams: ProbeStream[];
	format: { format_name: string; duration?: string };
}

const children = new Set<ChildProcess>();
let suspended = false;

/** Freezes (SIGSTOP) or resumes (SIGCONT) every running ffmpeg/ffprobe, and the ones started later. */
export function setSuspended(value: boolean) {
	suspended = value;
	for (const child of children) child.kill(value ? 'SIGSTOP' : 'SIGCONT');
}

export function run(
	cmd: string,
	args: string[],
	options: {
		cwd?: string;
		onStdout?: (chunk: string) => void;
		signal?: AbortSignal;
		/** Frozen with the worker; off for work that isn't the worker's, like scanning. */
		pausable?: boolean;
	} = {}
) {
	return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
		const child = spawn(cmd, args, {
			cwd: options.cwd,
			stdio: ['ignore', 'pipe', 'pipe'],
			signal: options.signal,
			// A frozen process only handles SIGTERM once resumed; SIGKILL works right away.
			killSignal: 'SIGKILL'
		});
		if (options.pausable !== false) {
			children.add(child);
			for (const event of ['close', 'error']) child.on(event, () => children.delete(child));
			if (suspended) child.kill('SIGSTOP');
		}
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
			if (options.onStdout) options.onStdout(chunk);
			else stdout += chunk;
		});
		child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
			stderr = (stderr + chunk).slice(-4000);
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) resolve({ stdout, stderr });
			else reject(new Error(`${cmd} exited with code ${code}\n${stderr}`));
		});
	});
}

export async function probe(
	file: string,
	signal?: AbortSignal,
	pausable?: boolean
): Promise<Probe> {
	const { stdout } = await run(
		'ffprobe',
		['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
		{ signal, pausable }
	);
	return JSON.parse(stdout);
}

/** Length in seconds, or null if ffprobe can't tell. Not frozen when the worker is paused. */
export async function probeDuration(file: string): Promise<number | null> {
	const { stdout } = await run(
		'ffprobe',
		['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
		{ pausable: false }
	);
	return Number(stdout.trim()) || null;
}

/** Every audio stream, with the preferred language (AUDIO_LANG) first: it becomes the default. */
function orderedAudio(streams: ProbeStream[]) {
	const preferred = normalizeLang(AUDIO_LANG);
	const audio = streams.filter((s) => s.codec_type === 'audio');
	const first =
		audio.find((s) => normalizeLang(s.tags?.language) === preferred) ??
		audio.find((s) => s.disposition?.default) ??
		audio[0];
	return first ? [first, ...audio.filter((s) => s !== first)] : [];
}

/** Subtitle codecs that can become WebVTT. Bitmap ones (DVD/Blu-ray) would need OCR. */
const TEXT_SUBTITLES = new Set(['subrip', 'ass', 'ssa', 'webvtt', 'mov_text', 'text']);

export function textSubtitleStreams(info: Probe) {
	return info.streams.filter(
		(s) => s.codec_type === 'subtitle' && TEXT_SUBTITLES.has(s.codec_name ?? '')
	);
}

const INTERLACED = new Set(['tt', 'bb', 'tb', 'bt']);
const SEGMENT_SECONDS = 6;

function videoFilters(video: ProbeStream) {
	return [
		...(INTERLACED.has(video.field_order ?? '') ? ['bwdif=mode=send_frame'] : []),
		// DVDs use non-square pixels; convert to square so every player gets the aspect right.
		"scale='trunc(iw*sar/2)*2':'trunc(ih/2)*2'",
		'setsar=1'
	];
}

/**
 * ffmpeg arguments to produce VOD HLS (fMP4) in the current directory: one video stream and one
 * audio rendition per source audio track, so the player can switch language. Streams that are
 * already compatible are copied instead of re-encoded.
 */
export function buildHlsArgs(input: string, info: Probe) {
	const video = info.streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
	if (!video) throw new Error('El fichero no tiene pista de vídeo');
	const audio = orderedAudio(info.streams);

	const interlaced = INTERLACED.has(video.field_order ?? '');
	const squarePixels =
		!video.sample_aspect_ratio || ['1:1', '0:1'].includes(video.sample_aspect_ratio);
	const copyVideo =
		video.codec_name === 'h264' && video.pix_fmt === 'yuv420p' && !interlaced && squarePixels;
	const copyAudio = audio.length > 0 && audio.every((a) => a.codec_name === 'aac');

	const args = ['-hide_banner', '-nostats', '-y', '-i', input, '-map', `0:${video.index}`];
	for (const a of audio) args.push('-map', `0:${a.index}`);
	args.push('-map_metadata', '-1', '-map_chapters', '-1', '-sn', '-dn');

	if (copyVideo) {
		args.push('-c:v', 'copy');
	} else {
		args.push(
			'-c:v',
			'libx264',
			'-preset',
			X264_PRESET,
			'-crf',
			X264_CRF,
			'-tune',
			'animation',
			'-profile:v',
			'high',
			'-pix_fmt',
			'yuv420p',
			'-vf',
			videoFilters(video).join(','),
			// Keyframes on segment boundaries, so every segment starts cleanly.
			'-force_key_frames',
			`expr:gte(t,n_forced*${SEGMENT_SECONDS})`
		);
	}

	if (audio.length) {
		if (copyAudio) args.push('-c:a', 'copy');
		else args.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2');
	}

	const tracks: AudioTrack[] = audio.map((a) => ({
		lang: normalizeLang(a.tags?.language),
		label: languageLabel(a.tags?.language)
	}));
	const streamMap = [
		`v:0${audio.length ? ',agroup:aud' : ''},name:video`,
		...tracks.map(
			(t, i) => `a:${i},agroup:aud,language:${t.lang},name:a${i}${i === 0 ? ',default:yes' : ''}`
		)
	];

	args.push(
		'-f',
		'hls',
		'-hls_time',
		String(SEGMENT_SECONDS),
		'-hls_playlist_type',
		'vod',
		'-hls_segment_type',
		'fmp4',
		'-hls_fmp4_init_filename',
		'init.mp4',
		'-hls_segment_filename',
		'%v/seg_%05d.m4s',
		'-master_pl_name',
		'master.m3u8',
		'-var_stream_map',
		streamMap.join(' '),
		'-progress',
		'pipe:1',
		'%v/index.m3u8'
	);
	return { args, tracks, copyVideo, copyAudio, interlaced };
}

/** Converts `input` into HLS inside `outDir` (which must exist). */
export async function transcodeHls(
	input: string,
	outDir: string,
	info: Probe,
	onProgress: (ratio: number) => void,
	signal?: AbortSignal
) {
	const duration = Number(info.format.duration) || 0;
	const { args, tracks } = buildHlsArgs(input, info);

	await run('ffmpeg', args, {
		cwd: outDir,
		signal,
		onStdout: (chunk) => {
			const match = chunk.match(/out_time_us=(\d+)/g)?.at(-1);
			if (match && duration > 0) {
				onProgress(Math.min(1, Number(match.split('=')[1]) / 1e6 / duration));
			}
		}
	});
	return { duration, audioTracks: tracks };
}

/** Converts an embedded subtitle stream or a sidecar .srt/.vtt/.ass file to WebVTT. */
export async function toWebVtt(
	input: string,
	output: string,
	streamIndex: number | undefined,
	signal?: AbortSignal
) {
	await run(
		'ffmpeg',
		[
			'-hide_banner',
			'-y',
			'-i',
			input,
			...(streamIndex === undefined ? [] : ['-map', `0:${streamIndex}`]),
			'-c:s',
			'webvtt',
			output
		],
		{ signal }
	);
}

export async function thumbnail(
	input: string,
	output: string,
	info: Probe,
	atSec: number,
	options: {
		signal?: AbortSignal;
		/**
		 * Decodes from the start up to `atSec` instead of seeking. Slower, but ffmpeg 7.1 (the one in
		 * the image) writes no frame when seeking into our HLS output.
		 */
		fromStart?: boolean;
		pausable?: boolean;
	} = {}
) {
	const video = info.streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
	// JPEG is full range: ffmpeg 7.1 refuses to encode limited-range video, which ours is.
	const filters = [...(video ? videoFilters(video) : []), 'scale=480:-2:out_range=full'];
	const seek = ['-ss', atSec.toFixed(2)];
	await run(
		'ffmpeg',
		[
			'-hide_banner',
			'-y',
			...(options.fromStart ? [] : seek),
			'-i',
			input,
			...(options.fromStart ? seek : []),
			'-an',
			'-frames:v',
			'1',
			'-update',
			'1',
			'-vf',
			filters.join(','),
			'-q:v',
			'4',
			output
		],
		{ signal: options.signal, pausable: options.pausable }
	);
}
