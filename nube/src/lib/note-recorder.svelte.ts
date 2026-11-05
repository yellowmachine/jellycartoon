import { music } from 'comun/music-player.svelte.ts';
import { MAX_NOTE_SECONDS } from '#lib/notes.ts';

/**
 * A note being recorded (#416): one at a time, tapped to start and tapped to stop, as one's hands
 * are busy walking. What plays pauses, so as not to be recorded, and goes on afterwards. The voice
 * is enough at this bitrate: about 240 KB a minute.
 */
const BITS_PER_SECOND = 32_000;
/** Shorter than this is a touch by mistake. */
const SHORTEST_MS = 800;

class NoteRecorder {
	recording = $state(false);
	seconds = $state(0);
	problem = $state<string | null>(null);

	#recorder: MediaRecorder | null = null;
	#timer: ReturnType<typeof setInterval> | undefined;
	#resume = false;

	/** Started; what it recorded goes to `done`. */
	async start(done: (audio: Blob) => void) {
		if (this.recording) return;
		this.problem = null;
		let stream: MediaStream;
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch {
			this.problem = 'No se puede usar el micrófono. Hay que darle permiso a la página.';
			return;
		}
		// The browser's own format: WebM/Opus on Android, MP4/AAC on iPhone.
		const recorder = new MediaRecorder(stream, { audioBitsPerSecond: BITS_PER_SECOND });
		const chunks: Blob[] = [];
		const started = Date.now();
		this.#resume = music.playing;
		if (this.#resume) music.pause();
		recorder.ondataavailable = (e) => chunks.push(e.data);
		recorder.onstop = () => {
			for (const track of stream.getTracks()) track.stop();
			clearInterval(this.#timer);
			this.recording = false;
			this.#recorder = null;
			if (this.#resume) music.resume();
			if (Date.now() - started >= SHORTEST_MS) done(new Blob(chunks, { type: recorder.mimeType }));
		};
		this.#recorder = recorder;
		recorder.start();
		this.recording = true;
		this.seconds = 0;
		this.#timer = setInterval(() => {
			this.seconds = Math.round((Date.now() - started) / 1000);
			if (this.seconds >= MAX_NOTE_SECONDS) this.stop();
		}, 500);
	}

	stop() {
		if (this.#recorder?.state === 'recording') this.#recorder.stop();
	}
}

export const noteRecorder = new NoteRecorder();
