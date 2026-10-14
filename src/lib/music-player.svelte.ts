import type { MusicTrack } from '#lib/music.ts';
import type { RadioStream } from '#lib/radio.ts';

/** In random order, with `first` first, so that the whole queue still comes after it. */
function shuffled(tracks: MusicTrack[], first: number) {
	const rest = tracks.filter((_, i) => i !== first);
	// Fisher–Yates.
	for (let i = rest.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[rest[i], rest[j]] = [rest[j], rest[i]];
	}
	return tracks[first] ? [tracks[first], ...rest] : rest;
}

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
	/** The queue in random order. */
	shuffle = $state(false);
	/** At the end, back to the start: of the queue, or of the track with `single`. */
	repeat = $state(false);
	/** Only the track that is on: it stops at its end, or starts again with `repeat`. */
	single = $state(false);

	/** The queue in its own order, while it is shuffled. */
	#ordered: MusicTrack[] = [];
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
		start = Math.min(Math.max(start, 0), tracks.length - 1);
		this.#ordered = tracks;
		this.queue = this.shuffle ? shuffled(tracks, start) : tracks;
		this.index = this.shuffle ? 0 : start;
	}

	setShuffle(value: boolean) {
		this.shuffle = value;
		if (!this.queue.length) return;
		const current = this.current;
		if (value) {
			this.#ordered = this.queue;
			this.queue = shuffled(this.queue, this.index);
			this.index = 0;
		} else {
			this.queue = this.#ordered;
			this.index = Math.max(this.queue.indexOf(current!), 0);
		}
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
		this.#ordered = [...this.#ordered, ...tracks];
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
		else if (!this.repeat) this.stop();
		else if (this.index > 0) this.index = 0;
		// Only one track: the same `src`, so it is started again here.
		else this.#restart();
	}

	/**
	 * The `<audio>` got to the end of the track. With single it stays there, and play starts it
	 * again; single with repeat is the `<audio>`'s own `loop`, which never gets here.
	 */
	ended() {
		if (!this.single) this.next();
	}

	#restart() {
		this.seek(0);
		void this.#audio?.play().catch(() => {});
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
		this.#ordered = [];
		this.index = 0;
	}
}

export const music = new MusicPlayer();
