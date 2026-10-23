import type { MusicTrack, SavedQueue } from '#lib/music.ts';
import type { PodcastPlaying, Speed } from '#lib/podcasts.ts';
import type { RadioStream } from '#lib/radio.ts';

/** The volume under spoken directions. */
const DUCKED_VOLUME = 0.25;

/** Seconds an episode goes back after being paused to speak to the voice assistant. */
const VOICE_REWIND = 3;

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
 * What is playing in this browser: a queue of tracks, a radio station or a podcast episode, and the `<audio>` of the
 * layout (MusicBar), so it goes on while moving around the app. Only changed in the browser, from
 * what the user does.
 */
class MusicPlayer {
	queue = $state<MusicTrack[]>([]);
	/** Live, instead of the queue. */
	radio = $state<RadioStream | null>(null);
	/** A podcast episode, instead of the queue. */
	podcast = $state<PodcastPlaying | null>(null);
	/** Podcasts only: music always sounds as it is. */
	speed = $state<Speed>(1);
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
	/** The queue is Modo DJ's (dj.svelte.ts): it fills itself, with the DJ between songs. */
	dj = $state(false);
	/**
	 * Brought back from the server (music_queue), paused where it was, until it is played: the
	 * browser does not let it sound by itself. Where it was playing, to say so.
	 */
	restored = $state<{ positionSec: number; changedBy: string } | null>(null);

	/** Paused while the user speaks to the voice assistant and it answers: it plays again after. */
	#pausedByVoice = false;
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

	/** What was playing on this or another device, paused; the station, already asked for. */
	restore(saved: SavedQueue, radio: RadioStream | null, podcast: PodcastPlaying | null = null) {
		this.restored = { positionSec: saved.positionSec, changedBy: saved.changedBy };
		this.dj = false;
		this.shuffle = saved.shuffle;
		this.repeat = saved.repeat;
		this.single = saved.single;
		this.positionSec = saved.positionSec;
		if (radio) return this.playRadio(radio, true);
		if (podcast) return this.playPodcast(podcast, true);
		this.#ordered = saved.tracks;
		this.queue = saved.tracks;
		this.index = saved.index;
	}

	/** Replaces the queue and starts it at `start`; `dj`, as Modo DJ's. */
	play(tracks: MusicTrack[], start = 0, dj = false) {
		this.restored = null;
		this.dj = dj;
		this.radio = null;
		this.podcast = null;
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
	playRadio(stream: RadioStream, restored = false) {
		if (!restored) this.restored = null;
		this.dj = false;
		this.queue = [];
		this.index = 0;
		this.podcast = null;
		this.radio = stream;
	}

	/** Instead of whatever was on, from where the user left it. */
	playPodcast(episode: PodcastPlaying, restored = false) {
		if (!restored) this.restored = null;
		this.dj = false;
		this.queue = [];
		this.#ordered = [];
		this.index = 0;
		this.radio = null;
		this.podcast = episode;
	}

	/** Back or forward that many seconds, within the episode. */
	skip(sec: number) {
		const end = this.durationSec ?? this.podcast?.durationSec ?? Infinity;
		this.seek(Math.min(Math.max(this.positionSec + sec, 0), end));
	}

	/** At the end of the queue; starts it if nothing was on. */
	append(tracks: MusicTrack[]) {
		if (!this.current) return this.play(tracks);
		this.queue = [...this.queue, ...tracks];
		this.#ordered = [...this.#ordered, ...tracks];
	}

	/** Right after the one that is on: the DJ's words. */
	insertNext(track: MusicTrack) {
		const current = this.current;
		if (!current) return;
		this.queue = this.queue.toSpliced(this.index + 1, 0, track);
		const k = this.#ordered.indexOf(current);
		if (k >= 0) this.#ordered = this.#ordered.toSpliced(k + 1, 0, track);
	}

	/** That one of the queue, now; the one on, played if it was paused. */
	jumpTo(i: number) {
		if (i < 0 || i >= this.queue.length) return;
		this.restored = null;
		if (i === this.index) return this.resume();
		this.index = i;
	}

	/** Out of the queue; not the one on, which «siguiente» or ✕ are for. */
	remove(i: number) {
		const track = this.queue[i];
		if (!track || i === this.index) return;
		this.queue = this.queue.filter((_, j) => j !== i);
		// Shuffled, the same track in its own order; otherwise both orders are the same.
		const k = this.shuffle ? this.#ordered.findIndex((t) => t.id === track.id) : i;
		if (k >= 0) this.#ordered = this.#ordered.filter((_, j) => j !== k);
		if (i < this.index) this.index--;
	}

	toggle() {
		if (!this.#audio) return;
		if (!this.#audio.paused) this.#audio.pause();
		else if (this.radio) this.resume();
		else this.#play();
	}

	pause() {
		this.#audio?.pause();
	}

	/** A station connects again: back to live, not to where it was paused. */
	resume() {
		this.restored = null;
		if (this.radio) this.radio = { ...this.radio };
		else this.#play();
	}

	/**
	 * After a network error (the phone asleep, no signal) the `<audio>` does not ask for the track
	 * again by itself, and play() does nothing: it is loaded again, from where it was.
	 */
	#play() {
		const audio = this.#audio;
		if (!audio) return;
		if (audio.error) {
			const at = audio.currentTime;
			audio.load();
			// Before loading, currentTime is where it starts.
			audio.currentTime = at;
		}
		void audio.play().catch(() => {});
	}

	/** The track or episode failed: tried again, unless something else has been played since. */
	retry() {
		if (this.#audio?.error) this.#play();
	}

	next() {
		this.restored = null;
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
		this.#play();
	}

	/** Past the first seconds, back to the start of the track, as players do. */
	previous() {
		this.restored = null;
		if (this.positionSec > 3 || this.index === 0) this.seek(0);
		else this.index--;
	}

	/**
	 * Pressed to speak: what plays here pauses, so that the microphone hears the question and the
	 * answer is heard (a podcast while cooking).
	 */
	pauseForVoice() {
		if (!this.playing) return;
		this.pause();
		this.#pausedByVoice = true;
	}

	get pausedForVoice() {
		return this.#pausedByVoice;
	}

	/** The answer was read: it goes on; an episode, a little before, to pick up the thread. */
	resumeAfterVoice() {
		if (!this.#pausedByVoice) return;
		this.#pausedByVoice = false;
		if (this.podcast) this.skip(-VOICE_REWIND);
		this.resume();
	}

	/** What was said changed what plays (another song, «para»): it is left as it is now. */
	forgetPause() {
		this.#pausedByVoice = false;
	}

	seek(sec: number) {
		if (this.#audio) this.#audio.currentTime = sec;
	}

	/**
	 * Lower while something else speaks over it (the road mode's directions, #78), and back: not
	 * paused, as a station would connect again.
	 */
	duck(on: boolean) {
		if (this.#audio) this.#audio.volume = on ? DUCKED_VOLUME : 1;
	}

	stop() {
		this.restored = null;
		this.dj = false;
		this.#audio?.pause();
		this.radio = null;
		this.podcast = null;
		this.queue = [];
		this.#ordered = [];
		this.index = 0;
	}
}

export const music = new MusicPlayer();
