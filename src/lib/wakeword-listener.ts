import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { WakeWordDetector, type WakeWordModel } from '#lib/wakeword.ts';

/**
 * Listening for wake words in this browser (#144): the microphone through an AudioWorklet that takes
 * it to 16 kHz (static/wakeword/capture.js), and openWakeWord's models (static/wakeword/) with ONNX Runtime Web,
 * served by the app. Only while the page is open and in front: the browser stops the microphone
 * otherwise.
 */

const MODELS_URL = '/wakeword';

export interface Listening {
	stop(): void;
	/** What the microphone and the audio are, for the page to say. */
	info: {
		/** The AudioContext's state: `running`, or `suspended` if the browser did not let it start. */
		state: AudioContextState;
		contextRate: number;
		/** As the browser reports the microphone. */
		micRate: number | null;
		/** Newer browsers may say which: `all`, `remote-only`. */
		echoCancellation: boolean | string | null;
		noiseSuppression: boolean | null;
		autoGainControl: boolean | null;
	};
}

export interface ListenOptions {
	/** Wake words' models, by their file name in static/wakeword (without `.onnx`). */
	models: string[];
	/** The browser's echo cancellation, noise suppression and gain: on, as for a call. */
	processing: boolean;
	/** Each 80 ms: every model's score, in the order of `models`, and the milliseconds it took. */
	onScores(scores: number[], ms: number): void;
	/** Each 80 ms: how loud the microphone is, in dBFS (0 the loudest; −90 silence). */
	onLevel(dbfs: number): void;
}

/**
 * `context`: made by the page on the tap that starts it, before anything is loaded. Made later
 * (after seconds loading models), Android leaves it suspended: no sound reached the detector.
 */
export async function listen(options: ListenOptions, context: AudioContext): Promise<Listening> {
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
	if (context.state !== 'running') await context.resume().catch(() => {});
	await context.audioWorklet.addModule(`${MODELS_URL}/capture.js`);
	const source = context.createMediaStreamSource(stream);
	const capture = new AudioWorkletNode(context, 'wakeword-capture');
	source.connect(capture);

	// One chunk at a time: if one takes longer than 80 ms, the next waits its turn.
	let queue = Promise.resolve();
	let stopped = false;
	capture.port.onmessage = (e: MessageEvent<Float32Array>) => {
		const chunk = e.data;
		let sum = 0;
		for (let i = 0; i < chunk.length; i++) sum += (chunk[i]! / 32768) ** 2;
		options.onLevel(10 * Math.log10(sum / chunk.length || 1e-9));
		queue = queue.then(async () => {
			if (stopped) return;
			const started = performance.now();
			for (const scores of await detector.push(chunk))
				options.onScores(scores, performance.now() - started);
		});
	};

	const settings = stream.getAudioTracks()[0]?.getSettings() ?? {};
	return {
		info: {
			state: context.state,
			contextRate: context.sampleRate,
			micRate: settings.sampleRate ?? null,
			echoCancellation: settings.echoCancellation ?? null,
			noiseSuppression: settings.noiseSuppression ?? null,
			autoGainControl: settings.autoGainControl ?? null
		},
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
