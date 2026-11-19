/**
 * Mensajes (#551): a voice note recorded while the button is held, as WhatsApp's. Opus where the
 * browser has it (webm), else what it records (mp4 on Safari). At most `MAX_SECONDS`.
 */
export const MAX_SECONDS = 5 * 60;
/** Shorter than this, a slip of the finger: not sent. */
const MIN_MS = 700;

/** By voice: quiet this long after having spoken, it is the end. */
const SILENCE_MS = 1600;
/** Louder than this (RMS of the samples, 0–1), someone speaks. */
const SPEECH_LEVEL = 0.02;

export class VoiceRecorder {
	recording = $state(false);
	seconds = $state(0);
	problem = $state<string | null>(null);
	#rec: MediaRecorder | null = null;
	#chunks: Blob[] = [];
	#started = 0;
	#timer: ReturnType<typeof setInterval> | undefined;
	#done: ((r: { blob: Blob; seconds: number } | null) => void) | null = null;

	/**
	 * By voice (#551): recorded until a silence after speaking (or `maxSeconds`), then what was
	 * said; null if nothing was said or it failed.
	 */
	async untilSilence(maxSeconds = 60): Promise<{ blob: Blob; seconds: number } | null> {
		await this.start();
		const stream = this.#stream;
		if (!this.recording || !stream) return null;
		const ctx = new AudioContext();
		const analyser = ctx.createAnalyser();
		ctx.createMediaStreamSource(stream).connect(analyser);
		const buf = new Float32Array(analyser.fftSize);
		let spoke = false;
		let quietSince = performance.now();
		const started = performance.now();
		return new Promise((resolve) => {
			const tick = setInterval(async () => {
				analyser.getFloatTimeDomainData(buf);
				const rms = Math.sqrt(buf.reduce((a, v) => a + v * v, 0) / buf.length);
				const now = performance.now();
				if (rms > SPEECH_LEVEL) {
					spoke = true;
					quietSince = now;
				}
				const done = (spoke && now - quietSince > SILENCE_MS) || now - started > maxSeconds * 1000;
				const nothing = !spoke && now - started > 8000;
				if (!done && !nothing) return;
				clearInterval(tick);
				void ctx.close();
				const got = await this.stop(nothing);
				resolve(got);
			}, 100);
		});
	}

	#stream: MediaStream | null = null;

	async start() {
		if (this.recording) return;
		this.problem = null;
		let stream: MediaStream;
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch {
			this.problem = 'Sin permiso para el micrófono';
			return;
		}
		const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((t) =>
			MediaRecorder.isTypeSupported(t)
		);
		this.#stream = stream;
		this.#rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
		this.#chunks = [];
		this.#rec.ondataavailable = (e) => e.data.size && this.#chunks.push(e.data);
		this.#rec.onstop = () => {
			stream.getTracks().forEach((t) => t.stop());
			const ms = performance.now() - this.#started;
			const blob = new Blob(this.#chunks, { type: this.#rec?.mimeType || type || 'audio/webm' });
			this.#done?.(ms < MIN_MS ? null : { blob, seconds: ms / 1000 });
			this.#done = null;
		};
		this.#started = performance.now();
		this.seconds = 0;
		this.recording = true;
		this.#rec.start();
		this.#timer = setInterval(() => {
			this.seconds = Math.floor((performance.now() - this.#started) / 1000);
			if (this.seconds >= MAX_SECONDS) void this.stop();
		}, 250);
	}

	/** Let go: what was recorded (null if too short, or `cancel`). */
	stop(cancel = false): Promise<{ blob: Blob; seconds: number } | null> {
		clearInterval(this.#timer);
		this.recording = false;
		const rec = this.#rec;
		this.#rec = null;
		if (!rec || rec.state === 'inactive') return Promise.resolve(null);
		return new Promise((resolve) => {
			this.#done = cancel ? () => resolve(null) : resolve;
			rec.stop();
		});
	}
}
