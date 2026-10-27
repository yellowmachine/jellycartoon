import { spawn } from 'node:child_process';
import { SAMPLE_RATE } from '../../src/lib/wakeword.ts';
import { toWav } from '../../src/lib/wakeword-recorder.ts';

/**
 * The satellite's speaker (#223, phase 3): `aplay` on `SPEAKER`, an ALSA device such as
 * `plughw:CARD=Headphones` (the Pi's jack; `aplay -L` lists them). Without it, nothing sounds.
 */

const SPEAKER = process.env.SPEAKER || null;

export const speakerName = SPEAKER;

/** The `aplay` playing now, and those waiting: one at a time, as the device takes only one. */
let current: ReturnType<typeof spawn> | null = null;
let queue = Promise.resolve();

/**
 * A WAV played to its end, after the ones before it; a speaker that fails is only logged, as the
 * order is done anyway.
 */
export function play(wav: Uint8Array): Promise<void> {
	if (!SPEAKER) return Promise.resolve();
	const done = queue.then(() => playNow(wav));
	queue = done;
	return done;
}

/** What is playing now, cut: a timer's ringing, when «hola casita» stops it. */
export function hush() {
	current?.kill();
}

function playNow(wav: Uint8Array): Promise<void> {
	return new Promise((resolve) => {
		const aplay = spawn('aplay', ['-D', SPEAKER!, '-q', '-'], {
			stdio: ['pipe', 'ignore', 'pipe']
		});
		current = aplay;
		let problem = '';
		aplay.stderr.on('data', (d: Buffer) => (problem += d.toString()));
		aplay.on('error', (err) => {
			console.error('aplay', err.message);
			current = null;
			resolve();
		});
		aplay.on('exit', (code, signal) => {
			if (code && !signal) console.error(`aplay terminó (${code}): ${problem.trim()}`);
			current = null;
			resolve();
		});
		aplay.stdin.on('error', () => {});
		aplay.stdin.end(wav);
	});
}

/** As the phone's (wake-word.svelte.ts): 880 Hz heard, 660 sent, 440 nothing said. */
export function beep(hz: number) {
	const samples = new Int16Array(Math.round(SAMPLE_RATE * 0.15));
	for (let i = 0; i < samples.length; i++) {
		// Faded in and out: no click.
		const fade = Math.min(1, i / 160, (samples.length - i) / 160);
		samples[i] = Math.round(8000 * fade * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE));
	}
	return play(toWav(samples));
}
