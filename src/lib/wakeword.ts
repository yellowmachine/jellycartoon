/**
 * Wake words in the browser (#144): openWakeWord's streaming pipeline
 * (https://github.com/dscripka/openWakeWord, openwakeword/utils.py `AudioFeatures` and model.py
 * `predict`), done here so that its ONNX models run on the phone. Audio at 16 kHz in chunks of
 * 80 ms (1280 samples) → a melspectrogram of each (with 480 samples before it) → every 8 of its
 * frames, an embedding of the last 76 → each wake word's model, on the last 16 embeddings.
 *
 * It only does the arithmetic: running a model is given (`Run`), so that the same code runs with
 * ONNX Runtime Web in the browser and with ONNX Runtime in a test.
 */

/** 80 ms at 16 kHz: what each step takes. */
export const CHUNK = 1280;
export const SAMPLE_RATE = 16_000;
/** Of audio before each chunk, for its melspectrogram: as openWakeWord's `160*3`. */
const CONTEXT = 480;
const MEL_BINS = 32;
/** Melspectrogram frames per embedding, and frames between one and the next. */
const WINDOW = 76;
const STEP = 8;
const EMBEDDING = 96;
/** As openWakeWord: about 10 s of each. */
const MEL_KEEP = 970;
const FEATURES_KEEP = 120;
/** The first predictions are zeroed while the buffers fill, as openWakeWord does. */
const WARM_UP = 5;

/** Runs a model on one input tensor and gives its first output, flat. */
export type Run = (model: string, input: Float32Array, dims: number[]) => Promise<Float32Array>;

export interface WakeWordModel {
	/** As `Run` knows it. */
	name: string;
	/** Embeddings it looks at: 16 for the community's models. */
	frames: number;
}

export class WakeWordDetector {
	/** The last CONTEXT samples, for the next chunk's melspectrogram; none before the first. */
	#tail = new Float32Array(0);
	/** Samples waiting for a whole chunk. */
	#pending: number[] = [];
	/** Melspectrogram frames, oldest first; starts as openWakeWord's `np.ones((76, 32))`. */
	#mel: Float32Array[] = Array.from({ length: WINDOW }, () => new Float32Array(MEL_BINS).fill(1));
	#features: Float32Array[] = [];
	#predictions = 0;

	constructor(
		private run: Run,
		private models: WakeWordModel[],
		/** The melspectrogram and embedding models' names, as `Run` knows them. */
		private feature = { melspectrogram: 'melspectrogram', embedding: 'embedding' }
	) {}

	/**
	 * Before listening: openWakeWord fills the embeddings with those of 4 s of quiet noise, so the
	 * models have 16 to look at from the start.
	 */
	async warmUp() {
		const noise = new Float32Array(SAMPLE_RATE * 4);
		for (let i = 0; i < noise.length; i++) noise[i] = Math.round(Math.random() * 2000 - 1000);
		const mel = await this.#melspectrogram(noise);
		const frames = mel.length / MEL_BINS;
		this.#features = [];
		for (let start = 0; start + WINDOW <= frames; start += STEP)
			this.#features.push(
				await this.#embedding(mel.subarray(start * MEL_BINS, (start + WINDOW) * MEL_BINS))
			);
	}

	/**
	 * More audio, 16 kHz, as int16 values (−32768…32767, in a float array). For each whole chunk,
	 * every model's score (0…1), in the order of `models`.
	 */
	async push(samples: ArrayLike<number>): Promise<number[][]> {
		for (let i = 0; i < samples.length; i++) this.#pending.push(samples[i]!);
		const scores: number[][] = [];
		while (this.#pending.length >= CHUNK) {
			const chunk = Float32Array.from(this.#pending.splice(0, CHUNK));
			scores.push(await this.#step(chunk));
		}
		return scores;
	}

	async #step(chunk: Float32Array) {
		const input = new Float32Array(this.#tail.length + CHUNK);
		input.set(this.#tail);
		input.set(chunk, this.#tail.length);
		this.#tail = input.slice(-CONTEXT);
		const mel = await this.#melspectrogram(input);
		for (let i = 0; i < mel.length; i += MEL_BINS) this.#mel.push(mel.slice(i, i + MEL_BINS));
		if (this.#mel.length > MEL_KEEP) this.#mel.splice(0, this.#mel.length - MEL_KEEP);

		const window = new Float32Array(WINDOW * MEL_BINS);
		this.#mel.slice(-WINDOW).forEach((frame, i) => window.set(frame, i * MEL_BINS));
		this.#features.push(await this.#embedding(window));
		if (this.#features.length > FEATURES_KEEP)
			this.#features.splice(0, this.#features.length - FEATURES_KEEP);

		this.#predictions++;
		return Promise.all(
			this.models.map(async (model) => {
				if (this.#predictions <= WARM_UP) return 0;
				const last = this.#features.slice(-model.frames);
				const input = new Float32Array(model.frames * EMBEDDING);
				last.forEach((f, i) => input.set(f, i * EMBEDDING));
				const [score] = await this.run(model.name, input, [1, model.frames, EMBEDDING]);
				return score ?? 0;
			})
		);
	}

	/** Frames × 32, transformed as openWakeWord does (`x / 10 + 2`). */
	async #melspectrogram(audio: Float32Array) {
		const out = await this.run(this.feature.melspectrogram, audio, [1, audio.length]);
		return out.map((x) => x / 10 + 2);
	}

	async #embedding(window: Float32Array) {
		return this.run(this.feature.embedding, window, [1, WINDOW, MEL_BINS, 1]);
	}
}
