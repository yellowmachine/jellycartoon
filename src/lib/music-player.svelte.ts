import type { MusicTrack } from '#lib/music.ts';
import type { RadioStream } from '#lib/radio.ts';

/**
 * What is playing in this browser: a queue of tracks, or a radio station, and the `<audio>` of the
 * layout (MusicBar), so it goes on while moving around the app. Only changed in the browser, from
 * what the user does.
 */
class MusicPlayer {
	queue = $state<MusicTrack[]>([]);
	/** Live, instead of the queue. */
	radio = $state<RadioStream | null>(null);
	index = $state(0);
	/** As the `<audio>` reports it. */
	playing = $state(false);
	positionSec = $state(0);
	durationSec = $state<number | null>(null);

	#audio: HTMLAudioElement | null = null;

	get current(): MusicTrack | undefined {
		return this.queue[this.index];
	}

	/** Called by MusicBar with its `<audio>`. */
	attach(audio: HTMLAudioElement | null) {
		this.#audio = audio;
	}

	/** Replaces the queue and starts it at `start`. */
	play(tracks: MusicTrack[], start = 0) {
		this.radio = null;
		this.queue = tracks;
		this.index = Math.min(Math.max(start, 0), tracks.length - 1);
	}

	/** Instead of whatever was on. */
	playRadio(stream: RadioStream) {
		this.queue = [];
		this.index = 0;
		this.radio = stream;
	}

	/** At the end of the queue; starts it if nothing was on. */
	append(tracks: MusicTrack[]) {
		if (!this.current) return this.play(tracks);
		this.queue = [...this.queue, ...tracks];
	}

	toggle() {
		if (!this.#audio) return;
		if (!this.#audio.paused) this.#audio.pause();
		else if (this.radio) this.resume();
		else void this.#audio.play().catch(() => {});
	}

	pause() {
		this.#audio?.pause();
	}

	/** A station connects again: back to live, not to where it was paused. */
	resume() {
		if (this.radio) this.radio = { ...this.radio };
		else void this.#audio?.play().catch(() => {});
	}

	next() {
		if (this.index < this.queue.length - 1) this.index++;
		else this.stop();
	}

	/** Past the first seconds, back to the start of the track, as players do. */
	previous() {
		if (this.positionSec > 3 || this.index === 0) this.seek(0);
		else this.index--;
	}

	seek(sec: number) {
		if (this.#audio) this.#audio.currentTime = sec;
	}

	stop() {
		this.#audio?.pause();
		this.radio = null;
		this.queue = [];
		this.index = 0;
	}
}

export const music = new MusicPlayer();
