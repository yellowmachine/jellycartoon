import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { SAMPLE_RATE, WakeWordDetector, type WakeWordModel } from '#lib/wakeword.ts';

/**
 * Listening for wake words in this browser (#144): the microphone at 16 kHz through an AudioWorklet
 * (static/wakeword/capture.js), and openWakeWord's models (static/wakeword/) with ONNX Runtime Web,
 * served by the app. Only while the page is open and in front: the browser stops the microphone
 * otherwise.
 */

const MODELS_URL = '/wakeword';

export interface Listening {
	stop(): void;
}

export interface ListenOptions {
	/** Wake words' models, by their file name in static/wakeword (without `.onnx`). */
	models: string[];
	/** The browser's echo cancellation, noise suppression and gain: on, as for a call. */
	processing: boolean;
	/** Each 80 ms: every model's score, in the order of `models`, and the milliseconds it took. */
	onScores(scores: number[], ms: number): void;
}

export async function listen(options: ListenOptions): Promise<Listening> {
	// Loaded only here: 14 MB of WebAssembly, for whoever tries it.
	const ort = await import('onnxruntime-web/wasm');
	ort.env.wasm.wasmPaths = { wasm: wasmUrl };
	// Threads need a cross-origin isolated page, which the app is not; these models are small.
	ort.env.wasm.numThreads = 1;

	const files = { melspectrogram: 'melspectrogram', embedding: 'embedding_model' } as Record<
		string,
		string
	>;
	for (const m of options.models) files[m] = m;
	const sessions = new Map<string, Awaited<ReturnType<typeof ort.InferenceSession.create>>>();
	for (const [name, file] of Object.entries(files))
		sessions.set(name, await ort.InferenceSession.create(`${MODELS_URL}/${file}.onnx`));

	const run = async (name: string, input: Float32Array, dims: number[]) => {
		const session = sessions.get(name)!;
		const out = await session.run({
			[session.inputNames[0]!]: new ort.Tensor('float32', input, dims)
		});
		return out[session.outputNames[0]!]!.data as Float32Array;
	};
	const models: WakeWordModel[] = options.models.map((name) => ({
		name,
		// What each model looks at, from its own input: [1, frames, 96].
		frames: Number(
			(sessions.get(name)!.inputMetadata[0] as { shape?: number[] } | undefined)?.shape?.[1] ?? 16
		)
	}));
	const detector = new WakeWordDetector(run, models);
	await detector.warmUp();

	const stream = await navigator.mediaDevices.getUserMedia({
		audio: {
			channelCount: 1,
			echoCancellation: options.processing,
			noiseSuppression: options.processing,
			autoGainControl: options.processing
		}
	});
	const context = new AudioContext({ sampleRate: SAMPLE_RATE });
	await context.audioWorklet.addModule(`${MODELS_URL}/capture.js`);
	const source = context.createMediaStreamSource(stream);
	const capture = new AudioWorkletNode(context, 'wakeword-capture');
	source.connect(capture);

	// One chunk at a time: if one takes longer than 80 ms, the next waits its turn.
	let queue = Promise.resolve();
	let stopped = false;
	capture.port.onmessage = (e: MessageEvent<Float32Array>) => {
		const chunk = e.data;
		queue = queue.then(async () => {
			if (stopped) return;
			const started = performance.now();
			for (const scores of await detector.push(chunk))
				options.onScores(scores, performance.now() - started);
		});
	};

	return {
		stop() {
			stopped = true;
			capture.port.onmessage = null;
			source.disconnect();
			capture.disconnect();
			for (const track of stream.getTracks()) track.stop();
			void context.close();
			for (const s of sessions.values()) void s.release();
		}
	};
}
