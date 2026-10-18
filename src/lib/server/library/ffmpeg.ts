import { spawn, type ChildProcess } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { setPriority } from 'node:os';
import { AUDIO_LANG, X264_CRF, X264_PRESET } from '$app/env/private';
import { languageLabel, normalizeLang, type AudioTrack } from '#lib/languages.ts';
import { chapterTitle, type Chapter } from '#lib/scenes.ts';
import { log } from '#lib/server/log.ts';

interface ProbeStream {
	index: number;
	codec_type: 'video' | 'audio' | 'subtitle' | 'data' | 'attachment';
	codec_name?: string;
	profile?: string;
	pix_fmt?: string;
	field_order?: string;
	sample_aspect_ratio?: string;
	width?: number;
	height?: number;
	color_transfer?: string;
	channels?: number;
	disposition?: { default?: number; attached_pic?: number; forced?: number };
	tags?: { language?: string };
}

export interface Probe {
	streams: ProbeStream[];
	format: { format_name: string; duration?: string; tags?: Record<string, string> };
	chapters?: { start_time: string; tags?: { title?: string } }[];
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
			// The worker's (conversions) at the lowest priority: they only take the CPU nobody else
			// wants, so the music on Snapcast, the app and the rest of the PC keep going smoothly.
			if (child.pid !== undefined) {
				try {
					setPriority(child.pid, 19);
				} catch (error) {
					log.warn('worker', 'No se pudo bajar la prioridad de ffmpeg', { error });
				}
			}
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
		[
			'-v',
			'error',
			'-print_format',
			'json',
			'-show_format',
			'-show_streams',
			'-show_chapters',
			file
		],
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
function orderedAudio(streams: ProbeStream[], lang = AUDIO_LANG) {
	const preferred = normalizeLang(lang);
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

/** PQ (HDR10, Dolby Vision base) and HLG. */
const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67']);

export const isHdr = (video: ProbeStream) => HDR_TRANSFERS.has(video.color_transfer ?? '');

/** HDR to SDR, so a thumbnail of an HDR film doesn't come out washed out. */
const TONEMAP = [
	'zscale=t=linear:npl=100',
	'format=gbrpf32le',
	'zscale=p=bt709',
	'tonemap=tonemap=hable:desat=0',
	'zscale=t=bt709:m=bt709:r=tv',
	'format=yuv420p'
];

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

/** One frame as a JPEG `width` pixels wide, with HDR tone mapped and DVDs deinterlaced. */
function frameFilters(info: Probe, width: number) {
	const video = info.streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
	// JPEG is full range: ffmpeg 7.1 refuses to encode limited-range video, which ours is.
	return [
		...(video && isHdr(video) ? TONEMAP : []),
		...(video ? videoFilters(video) : []),
		`scale=${width}:-2:out_range=full`
	];
}

/** A frame that takes longer has ffmpeg stuck: it is killed, so its turn is not taken forever. */
const FRAME_TIMEOUT_MS = 60_000;

/**
 * A frame of a video file, kept in memory (nothing is written to disk). Never frozen with the
 * worker: someone is waiting for it. `fromStart`: decodes up to `atSec` instead of seeking, for our
 * HLS output (see `thumbnail`). `signal`: ffmpeg is killed when it is aborted.
 */
export function frame(
	input: string,
	info: Probe,
	atSec: number,
	width: number,
	fromStart = false,
	signal?: AbortSignal
) {
	const seek = ['-ss', atSec.toFixed(2)];
	return new Promise<Buffer>((resolve, reject) => {
		const child = spawn(
			'ffmpeg',
			[
				'-hide_banner',
				...(fromStart ? [] : seek),
				'-i',
				input,
				...(fromStart ? seek : []),
				'-an',
				'-sn',
				'-frames:v',
				'1',
				'-vf',
				frameFilters(info, width).join(','),
				'-q:v',
				'4',
				'-f',
				'image2pipe',
				'-c:v',
				'mjpeg',
				'pipe:1'
			],
			{
				stdio: ['ignore', 'pipe', 'pipe'],
				signal: AbortSignal.any([
					AbortSignal.timeout(FRAME_TIMEOUT_MS),
					...(signal ? [signal] : [])
				]),
				killSignal: 'SIGKILL'
			}
		);
		const chunks: Buffer[] = [];
		let stderr = '';
		child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
		child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
			stderr = (stderr + chunk).slice(-4000);
		});
		child.on('error', reject);
		child.on('close', (code) => {
			const jpeg = Buffer.concat(chunks);
			if (code === 0 && jpeg.length) resolve(jpeg);
			else reject(new Error(`ffmpeg exited with code ${code}\n${stderr}`));
		});
	});
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
	const filters = frameFilters(info, 480);
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

/**
 * `seconds` of a video file from `atSec`, as an MP4 any browser plays: H.264 copied when it can be
 * (then it starts at the keyframe before `atSec`) and otherwise made at most 1280 wide, with HDR
 * tone mapped; the audio in `audioLang` (or the default track), as stereo AAC. Never frozen with
 * the worker: someone is waiting for it.
 */
export async function clip(
	input: string,
	output: string,
	info: Probe,
	options: { atSec: number; seconds: number; audioLang?: string | null }
) {
	const video = info.streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
	if (!video) throw new Error('El fichero no tiene pista de vídeo');
	const [audio] = orderedAudio(info.streams, options.audioLang ?? AUDIO_LANG);
	const squarePixels =
		!video.sample_aspect_ratio || ['1:1', '0:1'].includes(video.sample_aspect_ratio);
	const copyVideo =
		video.codec_name === 'h264' &&
		video.pix_fmt === 'yuv420p' &&
		!INTERLACED.has(video.field_order ?? '') &&
		squarePixels &&
		!isHdr(video);

	await run(
		'ffmpeg',
		[
			'-hide_banner',
			'-nostats',
			'-y',
			'-ss',
			options.atSec.toFixed(2),
			'-i',
			input,
			'-t',
			String(options.seconds),
			'-map',
			`0:${video.index}`,
			...(audio ? ['-map', `0:${audio.index}`] : []),
			'-map_metadata',
			'-1',
			'-map_chapters',
			'-1',
			'-sn',
			'-dn',
			...(copyVideo
				? ['-c:v', 'copy']
				: [
						'-c:v',
						'libx264',
						'-preset',
						'veryfast',
						'-crf',
						'23',
						'-profile:v',
						'high',
						'-vf',
						[
							...(isHdr(video) ? TONEMAP : []),
							...videoFilters(video),
							"scale='min(1280,iw)':-2",
							'format=yuv420p'
						].join(',')
					]),
			...(audio ? ['-c:a', 'aac', '-b:a', '128k', '-ac', '2'] : []),
			// The index first, so the browser can start playing before it has the whole file.
			'-movflags',
			'+faststart',
			'-f',
			'mp4',
			output
		],
		{ pausable: false }
	);
}

/**
 * Only the audio of a stretch, as AAC in .m4a (any browser plays it, Safari too): for the clips sent
 * to Langua. With `info`, the track in `audioLang` (a film's file); without it, the first one (an
 * episode's audio rendition, which has only its own).
 */
export async function audioClip(
	input: string,
	output: string,
	options: { atSec: number; seconds: number; info?: Probe; audioLang?: string | null }
) {
	const [audio] = options.info
		? orderedAudio(options.info.streams, options.audioLang ?? AUDIO_LANG)
		: [];
	if (options.info && !audio) throw new Error('El fichero no tiene audio');
	const seek = ['-ss', options.atSec.toFixed(2)];
	// An episode's HLS: with -ss before -i, the ffmpeg in the image (7.1, Debian) reads it to the
	// end and writes nothing. After -i it decodes from the start and drops what comes before:
	// slower, but AAC decodes in seconds even for hours of it.
	const hls = !options.info;
	await run(
		'ffmpeg',
		[
			'-hide_banner',
			'-nostats',
			'-y',
			...(hls ? [] : seek),
			'-i',
			input,
			...(hls ? seek : []),
			'-t',
			String(options.seconds),
			'-map',
			audio ? `0:${audio.index}` : '0:a:0',
			'-vn',
			'-sn',
			'-dn',
			'-map_metadata',
			'-1',
			'-c:a',
			'aac',
			'-b:a',
			'96k',
			'-ac',
			'2',
			'-movflags',
			'+faststart',
			'-f',
			'mp4',
			output
		],
		{ pausable: false }
	);
	// ffmpeg says nothing when it writes no audio (a seek past what it found): an empty file is
	// not a clip, and must not be sent as one.
	const duration = await probeDuration(output);
	if (!duration || duration < options.seconds / 2)
		throw new Error(
			`ffmpeg sacó ${duration ? `${Math.round(duration)} s` : 'un audio vacío'} en vez de ${options.seconds} s`
		);
	return audio ? normalizeLang(audio.tags?.language) : null;
}

/**
 * An audio track as WAV pieces of `chunkSec` (16 kHz mono, what Whisper wants), in `outDir`: one
 * pass over the file, and the pieces in order. `audio`: which audio track, in order (a film's);
 * an episode's rendition has only its own, the first.
 */
export async function speechChunks(
	input: string,
	outDir: string,
	options: { chunkSec: number; audio?: number; signal?: AbortSignal }
) {
	await run(
		'ffmpeg',
		[
			'-hide_banner',
			'-nostats',
			'-y',
			'-i',
			input,
			'-map',
			`0:a:${options.audio ?? 0}`,
			'-vn',
			'-sn',
			'-dn',
			'-ac',
			'1',
			'-ar',
			'16000',
			'-c:a',
			'pcm_s16le',
			'-f',
			'segment',
			'-segment_time',
			String(options.chunkSec),
			path.join(outDir, 'trozo_%05d.wav')
		],
		{ signal: options.signal, pausable: false }
	);
	return (await readdir(outDir))
		.filter((f) => /^trozo_\d+\.wav$/.test(f))
		.sort()
		.map((f) => path.join(outDir, f));
}

/** Seeking lands on the keyframe before: read from earlier, so no cue of the stretch is missed. */
const SUBTITLE_MARGIN_SEC = 30;

/**
 * A stretch of a film's text subtitles in `lang` (or, without one in it, the first), as WebVTT
 * with the film's own times: it also has cues from a bit before, for the caller to keep only the
 * stretch's. Null if it has none.
 */
export async function subtitleClip(
	input: string,
	info: Probe,
	options: { atSec: number; seconds: number; lang: string | null }
) {
	const streams = textSubtitleStreams(info);
	const stream =
		streams.find(
			(s) => options.lang && normalizeLang(s.tags?.language) === normalizeLang(options.lang)
		) ?? streams[0];
	if (!stream) return null;
	const { stdout } = await run(
		'ffmpeg',
		[
			'-hide_banner',
			'-nostats',
			'-ss',
			Math.max(0, options.atSec - SUBTITLE_MARGIN_SEC).toFixed(2),
			'-i',
			input,
			// Times as in the film: from the stretch's start they would be wrong after the seek. With
			// them, the end is a time in the film too (`-to`), not a length.
			'-copyts',
			'-to',
			(options.atSec + options.seconds).toFixed(2),
			'-map',
			`0:${stream.index}`,
			'-c:s',
			'webvtt',
			'-f',
			'webvtt',
			'pipe:1'
		],
		{ pausable: false }
	);
	return { vtt: stdout, lang: normalizeLang(stream.tags?.language) };
}

const CHANNELS: Record<number, string> = { 1: 'mono', 2: 'estéreo', 6: '5.1', 8: '7.1' };

/** The file's chapters, in order: usually the disc's, with generic names. */
export function describeChapters(info: Probe): Chapter[] {
	return (info.chapters ?? [])
		.map((c) => ({ startSec: Number(c.start_time) || 0, title: chapterTitle(c.tags?.title) }))
		.sort((a, b) => a.startSec - b.startSec);
}

/**
 * What a film has, to show it without converting anything: e.g. `1920×1080 · h264 · HDR`, audio
 * `English · 5.1` and subtitles `Español (forzados)`.
 */
export function describeStreams(info: Probe) {
	const video = info.streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
	const track = (s: ProbeStream, extra: string | undefined) => ({
		lang: normalizeLang(s.tags?.language),
		label: [languageLabel(s.tags?.language), extra].filter(Boolean).join(' · ')
	});
	return {
		video: video
			? [
					video.width && video.height ? `${video.width}×${video.height}` : null,
					video.codec_name,
					isHdr(video) ? 'HDR' : null
				]
					.filter(Boolean)
					.join(' · ')
			: null,
		audioTracks: info.streams
			.filter((s) => s.codec_type === 'audio')
			.map((s) =>
				track(s, CHANNELS[s.channels ?? 0] ?? (s.channels ? `${s.channels} canales` : undefined))
			),
		subtitles: info.streams
			.filter((s) => s.codec_type === 'subtitle')
			.map((s) => track(s, s.disposition?.forced ? 'forzados' : undefined))
	};
}
