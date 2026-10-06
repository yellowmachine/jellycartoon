import { spawn } from 'node:child_process';
import { AUDIO_LANG, X264_CRF, X264_PRESET } from '$app/env/private';

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

function run(cmd: string, args: string[], onStdout?: (chunk: string) => void) {
	return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
		const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
			if (onStdout) onStdout(chunk);
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

export async function probe(file: string): Promise<Probe> {
	const { stdout } = await run('ffprobe', [
		'-v',
		'error',
		'-print_format',
		'json',
		'-show_format',
		'-show_streams',
		file
	]);
	return JSON.parse(stdout);
}

function pickAudio(streams: ProbeStream[]) {
	const audio = streams.filter((s) => s.codec_type === 'audio');
	return (
		audio.find((s) => s.tags?.language === AUDIO_LANG) ??
		audio.find((s) => s.disposition?.default) ??
		audio[0]
	);
}

const INTERLACED = new Set(['tt', 'bb', 'tb', 'bt']);

/**
 * Builds the ffmpeg arguments to produce a browser-friendly MP4 (H.264 + AAC, faststart).
 * Streams that are already compatible are copied instead of re-encoded.
 */
export function buildTranscodeArgs(input: string, output: string, info: Probe) {
	const video = info.streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
	if (!video) throw new Error('El fichero no tiene pista de vídeo');
	const audio = pickAudio(info.streams);

	const interlaced = INTERLACED.has(video.field_order ?? '');
	const squarePixels =
		!video.sample_aspect_ratio || ['1:1', '0:1'].includes(video.sample_aspect_ratio);
	const copyVideo =
		video.codec_name === 'h264' && video.pix_fmt === 'yuv420p' && !interlaced && squarePixels;
	const copyAudio = audio?.codec_name === 'aac';

	const args = ['-hide_banner', '-nostats', '-y', '-i', input, '-map', `0:${video.index}`];
	if (audio) args.push('-map', `0:${audio.index}`);
	args.push('-map_metadata', '-1', '-map_chapters', '-1', '-sn', '-dn');

	if (copyVideo) {
		args.push('-c:v', 'copy');
	} else {
		const filters = [
			...(interlaced ? ['bwdif=mode=send_frame'] : []),
			// DVDs use non-square pixels; convert to square so every player gets the aspect right.
			"scale='trunc(iw*sar/2)*2':'trunc(ih/2)*2'",
			'setsar=1'
		];
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
			filters.join(',')
		);
	}

	if (audio) {
		if (copyAudio) args.push('-c:a', 'copy');
		else args.push('-c:a', 'aac', '-b:a', '160k', '-ac', '2');
	}

	args.push('-movflags', '+faststart', '-f', 'mp4', '-progress', 'pipe:1', output);
	return { args, copyVideo, copyAudio, interlaced };
}

export async function transcode(
	input: string,
	output: string,
	onProgress: (ratio: number) => void
) {
	const info = await probe(input);
	const duration = Number(info.format.duration) || 0;
	const { args } = buildTranscodeArgs(input, output, info);

	await run('ffmpeg', args, (chunk) => {
		const match = chunk.match(/out_time_us=(\d+)/g)?.at(-1);
		if (match && duration > 0) {
			onProgress(Math.min(1, Number(match.split('=')[1]) / 1e6 / duration));
		}
	});
	return { duration };
}

export async function thumbnail(input: string, output: string, atSec: number) {
	await run('ffmpeg', [
		'-hide_banner',
		'-y',
		'-ss',
		atSec.toFixed(2),
		'-i',
		input,
		'-frames:v',
		'1',
		'-vf',
		'scale=480:-2',
		'-q:v',
		'4',
		output
	]);
}
