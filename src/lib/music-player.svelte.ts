import type { MusicTrack, SavedQueue } from '#lib/music.ts';
import type { PodcastPlaying, Speed } from '#lib/podcasts.ts';
import type { RadioStream } from '#lib/radio.ts';
import type { EpisodeListening } from '#lib/episode-audio.ts';
import { watchPlay } from '#lib/media-diagnostics.ts';

/** The volume under spoken directions. */
const DUCKED_VOLUME = 0.25;
/** This browser's volume, from the bar on a PC (phones and tablets have their buttons). */
const VOLUME_KEY = 'jellycartoon:volume';

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
	/** An episode of the library only listened to (#154), instead of the queue. */
	listening = $state<EpisodeListening | null>(null);
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
	/** «Para al acabar esta canción» (the voice): the track it stops after; null, none. */
	stopAfterId = $state<number | null>(null);
	/** «Para dentro de media hora»: when (Date.now()), then at the end of the song on; or null. */
	stopAt = $state<number | null>(null);
	#stopTimer: ReturnType<typeof setTimeout> | undefined;
	/**
	 * Brought back from the server (music_queue), paused where it was, until it is played: the
	 * browser does not let it sound by itself. Where it was playing, to say so.
	 */
	restored = $state<{ positionSec: number; changedBy: string } | null>(null);
	/** From 0 to 1, as the PC's slider leaves it; kept in this browser. */
	volume = $state(1);
	muted = $state(false);

	/** Paused while the user speaks to the voice assistant and it answers: it plays again after. */
	#pausedByVoice = false;
	/** The queue in its own order, while it is shuffled. */
	#ordered: MusicTrack[] = [];
	#audio: HTMLAudioElement | null = null;
	/** Who speaks over it now, lowering it (duck): the voice, the road's directions, the DJ. */
	#duckedBy = new Set<string>();
	/** The volume going down or up, little by little. */
	#fading: ReturnType<typeof setInterval> | undefined;
	/**
	 * When someone last asked to pause (Date.now()): the app, the lock screen or the voice. A pause
	 * not asked for, with the screen off, is the phone's alone (auto-resume.ts).
	 */
	askedPauseAt = 0;

	get current(): MusicTrack | undefined {
		return this.queue[this.index];
	}

	/** Called by MusicBar with its `<audio>`. */
	attach(audio: HTMLAudioElement | null) {
		if (audio && !this.#audio) this.#loadVolume();
		this.#audio = audio;
		this.#applyVolume();
	}

	setVolume(volume: number) {
		this.volume = Math.min(1, Math.max(0, volume));
		this.muted = this.volume === 0;
		this.#applyVolume();
		this.#saveVolume();
	}

	/** Silenced, and back as it was; from nothing, to half. */
	toggleMute() {
		if (this.muted && this.volume === 0) this.volume = 0.5;
		this.muted = !this.muted;
		this.#applyVolume();
		this.#saveVolume();
	}

	/** What the `<audio>` should sound at: the volume chosen, lower while something speaks. */
	get #targetVolume() {
		return this.muted ? 0 : this.volume * (this.#duckedBy.size ? DUCKED_VOLUME : 1);
	}

	/** At once, or in `fadeMs` (the DJ coming in and going): never a jump from one song to another. */
	#applyVolume(fadeMs = 0) {
		clearInterval(this.#fading);
		const audio = this.#audio;
		if (!audio) return;
		const to = this.#targetVolume;
		if (!fadeMs) return void (audio.volume = to);
		const from = audio.volume;
		const started = Date.now();
		this.#fading = setInterval(() => {
			const done = Math.min(1, (Date.now() - started) / fadeMs);
			audio.volume = from + (to - from) * done;
			if (done === 1) clearInterval(this.#fading);
		}, 50);
	}

	#loadVolume() {
		try {
			const saved = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? 'null');
			if (typeof saved?.volume === 'number') this.volume = Math.min(1, Math.max(0, saved.volume));
			if (typeof saved?.muted === 'boolean') this.muted = saved.muted;
		} catch {
			// A private window: as it comes.
		}
	}

	#saveVolume() {
		try {
			localStorage.setItem(VOLUME_KEY, JSON.stringify({ volume: this.volume, muted: this.muted }));
		} catch {
			// A private window: only for now.
		}
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
		this.listening = null;
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
		this.listening = null;
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
		this.listening = null;
		this.podcast = episode;
	}

	/** An episode of the library, only its audio (#154), instead of whatever was on. */
	listenTo(episode: EpisodeListening) {
		this.restored = null;
		this.dj = false;
		this.queue = [];
		this.#ordered = [];
		this.index = 0;
		this.radio = null;
		this.podcast = null;
		this.listening = episode;
	}

	/** Back or forward that many seconds, within the episode. */
	skip(sec: number) {
		const end =
			this.durationSec ?? this.podcast?.durationSec ?? this.listening?.durationSec ?? Infinity;
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
		if (!this.#audio.paused) this.pause();
		else if (this.radio) this.resume();
		else this.#play();
	}

	pause() {
		this.askedPauseAt = Date.now();
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
		watchPlay(audio.play(), 'música');
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
		const after = this.stopAfterId;
		this.stopAfterId = null;
		// Only if it is still that one: another one on is not «esta canción».
		if (after !== null && after === this.current?.id) return this.stop();
		if (!this.single) this.next();
	}

	/** «Para al acabar esta canción»: false if no song is on (a station has no end to wait for). */
	stopAfterTrack() {
		const track = this.current;
		if (!track || this.radio || this.podcast || this.listening) return false;
		this.stopAfterId = track.id;
		return true;
	}

	/** Neither of them: the bar's ✕. */
	cancelStop() {
		this.stopAfterId = null;
		this.stopIn(0);
	}

	/** «Para dentro de media hora»: then, at the end of the song on (else at once). 0, no longer. */
	stopIn(minutes: number) {
		clearTimeout(this.#stopTimer);
		this.stopAt = minutes ? Date.now() + minutes * 60_000 : null;
		if (!minutes) return;
		this.#stopTimer = setTimeout(() => {
			this.stopAt = null;
			if (!this.stopAfterTrack()) this.stop();
		}, minutes * 60_000);
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
	 * Lower while something else speaks over it (the road mode's directions, #78; the DJ mixed over
	 * the songs, `dj`), and back to the volume chosen once nothing does: not paused, as a station
	 * would connect again.
	 */
	duck(on: boolean, by = 'voz', fadeMs = 0) {
		if (on) this.#duckedBy.add(by);
		else this.#duckedBy.delete(by);
		this.#applyVolume(fadeMs);
	}

	stop() {
		this.restored = null;
		this.dj = false;
		this.stopAfterId = null;
		clearTimeout(this.#stopTimer);
		this.stopAt = null;
		this.askedPauseAt = Date.now();
		this.#audio?.pause();
		this.radio = null;
		this.podcast = null;
		this.listening = null;
		this.queue = [];
		this.#ordered = [];
		this.index = 0;
	}
}

export const music = new MusicPlayer();
