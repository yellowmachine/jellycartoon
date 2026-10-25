import { SAMPLE_RATE } from '#lib/wakeword.ts';

/**
 * Recording the house's voices saying the wake word (#144, phase 3): the microphone as the
 * detector hears it (static/wakeword/capture.js: 16 kHz, int16 values), in takes of a fixed
 * length, as WAV files.
 */

export interface Recorder {
	/** The next `ms` of sound. */
	take(ms: number): Promise<Int16Array>;
	/** The microphone off; a take under way ends with what it has. */
	stop(): void;
}

/**
 * `context`: made by the page on the tap that starts it (see wakeword-listener.ts). `processing`:
 * the browser's echo cancellation, noise suppression and gain, as when listening.
 */
export async function record(
	context: AudioContext,
	processing: boolean,
	onLevel: (dbfs: number) => void
): Promise<Recorder> {
	const stream = await navigator.mediaDevices.getUserMedia({
		audio: {
			channelCount: 1,
			echoCancellation: processing,
			noiseSuppression: processing,
			autoGainControl: processing
		}
	});
	if (context.state !== 'running') await context.resume().catch(() => {});
	await context.audioWorklet.addModule('/wakeword/capture.js');
	const source = context.createMediaStreamSource(stream);
	const capture = new AudioWorkletNode(context, 'wakeword-capture');
	source.connect(capture);

	let wanted = 0;
	let got: Float32Array[] = [];
	let done: ((samples: Int16Array) => void) | null = null;
	capture.port.onmessage = (e: MessageEvent<Float32Array>) => {
		const chunk = e.data;
		let sum = 0;
		for (let i = 0; i < chunk.length; i++) sum += (chunk[i]! / 32768) ** 2;
		onLevel(10 * Math.log10(sum / chunk.length || 1e-9));
		if (!done) return;
		got.push(chunk);
		if (got.length * chunk.length < wanted) return;
		const samples = new Int16Array(wanted);
		let at = 0;
		for (const c of got) {
			const n = Math.min(c.length, wanted - at);
			samples.set(c.subarray(0, n), at);
			at += n;
		}
		const resolve = done;
		done = null;
		got = [];
		resolve(samples);
	};

	return {
		take(ms) {
			wanted = Math.round((ms / 1000) * SAMPLE_RATE);
			got = [];
			return new Promise((resolve) => (done = resolve));
		},
		stop() {
			if (done) {
				const parts = got;
				const samples = new Int16Array(parts.reduce((n, c) => n + c.length, 0));
				let at = 0;
				for (const c of parts) {
					samples.set(c, at);
					at += c.length;
				}
				const resolve = done;
				done = null;
				got = [];
				resolve(samples);
			}
			capture.port.onmessage = null;
			source.disconnect();
			capture.disconnect();
			for (const track of stream.getTracks()) track.stop();
		}
	};
}

/** The loudest 80 ms of a take, in dBFS: to know whether anything was said. */
export function peakLevel(samples: Int16Array) {
	let best = 0;
	for (let start = 0; start < samples.length; start += 1280) {
		let sum = 0;
		const end = Math.min(start + 1280, samples.length);
		for (let i = start; i < end; i++) sum += (samples[i]! / 32768) ** 2;
		best = Math.max(best, sum / (end - start));
	}
	return 10 * Math.log10(best || 1e-9);
}

/** 16 kHz, mono, 16 bits. */
export function toWav(samples: Int16Array) {
	const bytes = new Uint8Array(44 + samples.length * 2);
	const view = new DataView(bytes.buffer);
	const text = (at: number, s: string) => {
		for (let i = 0; i < 4; i++) bytes[at + i] = s.charCodeAt(i);
	};
	text(0, 'RIFF');
	view.setUint32(4, 36 + samples.length * 2, true);
	text(8, 'WAVE');
	text(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, SAMPLE_RATE, true);
	view.setUint32(28, SAMPLE_RATE * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	text(36, 'data');
	view.setUint32(40, samples.length * 2, true);
	for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i]!, true);
	return bytes;
}
