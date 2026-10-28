import type Hls from 'hls.js';
import { coverUrl, trackUrl, type MusicPass, type MusicTrack } from '#lib/music.ts';

/**
 * The road mode's player (#253): the house's songs, in a queue, and the radio. As jellycartoon's
 * (#180): two `<audio>` that take turns, the next song loading in the other and starting just
 * before this one ends, so the page is never silent between two songs; with the screen off, a
 * phone stops a page that went quiet. Controlled too from the lock screen and the car's buttons
 * (Media Session).
 */

/** This long before the end of a song, the next one is started in the other `<audio>`. */
const HANDOFF_SEC = 1.5;
/** And this much before it ends, so that they overlap a moment rather than leave a gap. */
const OVERLAP_MS = 150;
/** Into the song, the next one starts loading: not while the last one still ends. */
const PRELOAD_AFTER_SEC = 5;

export interface RadioPlaying {
	uuid: string;
	name: string;
	favicon: string | null;
	url: string;
	hls: boolean;
}

class RoadPlayer {
	queue = $state<MusicTrack[]>([]);
	index = $state(0);
	radio = $state<RadioPlaying | null>(null);
	playing = $state(false);
	positionSec = $state(0);
	durationSec = $state(0);
	problem = $state<string | null>(null);

	#players: HTMLAudioElement[] = [];
	#active = 0;
	#pass: MusicPass | null = null;
	#renewPass: (() => Promise<MusicPass | null>) | null = null;
	#handoff: ReturnType<typeof setTimeout> | undefined;
	#hls: Hls | null = null;
	/** A track that failed is tried again once with a new pass (the old one may have expired). */
	#retried = new Set<number>();

	get current() {
		return this.radio ? null : (this.queue[this.index] ?? null);
	}

	get #audio() {
		return this.#players[this.#active];
	}

	get #spare() {
		return this.#players[1 - this.#active];
	}

	/** The page's two `<audio>`, and how to ask for a new pass when the one it has expires. */
	attach(a: HTMLAudioElement, b: HTMLAudioElement, renewPass: () => Promise<MusicPass | null>) {
		this.#players = [a, b];
		this.#renewPass = renewPass;
		for (const el of this.#players) {
			el.addEventListener('timeupdate', () => el === this.#audio && this.#tick());
			el.addEventListener('ended', () => el === this.#audio && this.#ended());
			el.addEventListener('play', () => el === this.#audio && (this.playing = true));
			el.addEventListener('pause', () => el === this.#audio && (this.playing = false));
			el.addEventListener('error', () => el === this.#audio && void this.#failed());
		}
		this.#mediaSession();
	}

	setPass(pass: MusicPass | null) {
		this.#pass = pass;
	}

	cover(track: MusicTrack | null) {
		return track?.hasCover && this.#pass ? coverUrl(this.#pass, track.albumId) : null;
	}

	#src(track: MusicTrack | undefined) {
		return track && this.#pass ? trackUrl(this.#pass, track.id) : null;
	}

	/** These songs, from that one. */
	play(tracks: MusicTrack[], start = 0) {
		this.#stopRadio();
		this.queue = tracks;
		this.index = start;
		this.#retried.clear();
		this.#load();
	}

	toggle() {
		const el = this.#audio;
		if (!el?.getAttribute('src') && !this.#hls) return;
		if (el.paused) void el.play().catch(() => {});
		else el.pause();
	}

	next() {
		if (this.radio || this.index + 1 >= this.queue.length) return;
		this.#goTo(this.index + 1);
	}

	/** Past the first seconds, back to the start of the song, as players do. */
	previous() {
		if (this.radio) return;
		if ((this.#audio?.currentTime ?? 0) > 3 || this.index === 0) {
			this.seek(0);
			return;
		}
		this.#goTo(this.index - 1);
	}

	seek(seconds: number) {
		const el = this.#audio;
		if (el && Number.isFinite(seconds)) el.currentTime = Math.max(0, seconds);
	}

	/** A station: its stream as it is (MP3, AAC), or through hls.js where the browser has no HLS. */
	async playRadio(station: RadioPlaying) {
		this.#stopTracks();
		this.radio = station;
		this.problem = null;
		const el = this.#audio;
		if (station.hls && !el.canPlayType('application/vnd.apple.mpegurl')) {
			const { default: HlsJs } = await import('hls.js');
			if (this.radio !== station || !HlsJs.isSupported()) return;
			this.#hls = new HlsJs();
			this.#hls.loadSource(station.url);
			this.#hls.attachMedia(el);
		} else el.src = station.url;
		void el.play().catch(() => {});
		this.#metadata();
	}

	stop() {
		this.#stopRadio();
		this.#stopTracks();
		this.queue = [];
		this.index = 0;
	}

	#goTo(index: number) {
		const spare = this.#spare;
		const src = this.#src(this.queue[index]);
		this.index = index;
		// Already loaded in the other: that one takes over, at once.
		if (src && spare?.getAttribute('src') === src && !spare.error) {
			this.#audio.pause();
			this.#swap();
			spare.currentTime = 0;
			void spare.play().catch(() => {});
			this.#afterChange();
			return;
		}
		this.#load();
	}

	#load() {
		const el = this.#audio;
		const src = this.#src(this.current ?? undefined);
		clearTimeout(this.#handoff);
		this.#handoff = undefined;
		this.#spare?.pause();
		if (!el) return;
		if (!src) {
			el.removeAttribute('src');
			el.load();
			return;
		}
		el.src = src;
		void el.play().catch(() => {});
		this.#afterChange();
	}

	#afterChange() {
		this.problem = null;
		this.positionSec = 0;
		this.#metadata();
	}

	#swap() {
		this.#active = 1 - this.#active;
	}

	#tick() {
		const el = this.#audio;
		this.positionSec = el.currentTime;
		this.durationSec = Number.isFinite(el.duration) ? el.duration : 0;
		if (this.radio) return;
		this.#preload();
		this.#planHandoff();
		if ('mediaSession' in navigator && this.durationSec)
			navigator.mediaSession.setPositionState?.({
				duration: this.durationSec,
				position: Math.min(this.positionSec, this.durationSec),
				playbackRate: el.playbackRate
			});
	}

	/** The next song, loading in the other `<audio>`: with the phone asleep, while this one sounds. */
	#preload() {
		const spare = this.#spare;
		const src = this.#src(this.queue[this.index + 1]);
		if (!spare || !spare.paused || this.#audio.currentTime < PRELOAD_AFTER_SEC) return;
		if (src && spare.getAttribute('src') !== src) {
			spare.preload = 'auto';
			spare.src = src;
		}
	}

	/** Near the end, with the next song loaded in the other: it starts just before this one ends. */
	#planHandoff() {
		const el = this.#audio;
		const spare = this.#spare;
		const upcoming = this.#src(this.queue[this.index + 1]);
		if (this.#handoff || !upcoming || !spare || el.paused || !Number.isFinite(el.duration)) return;
		const left = (el.duration - el.currentTime) / el.playbackRate;
		if (left > HANDOFF_SEC || spare.getAttribute('src') !== upcoming || spare.error) return;
		const ending = this.index;
		this.#handoff = setTimeout(
			() => {
				this.#handoff = undefined;
				// Paused, moved or another song meanwhile: as it was, at its end.
				if (el !== this.#audio || el.paused || this.index !== ending) return;
				if (spare.getAttribute('src') !== upcoming) return;
				spare.currentTime = 0;
				spare.volume = el.volume;
				void spare.play().catch(() => {});
				this.#swap();
				this.index = ending + 1;
				this.#afterChange();
			},
			Math.max(0, left * 1000 - OVERLAP_MS)
		);
	}

	/** Only the one that sounds: the one that handed over ends after, and is not listened to. */
	#ended() {
		if (this.index + 1 < this.queue.length) this.#goTo(this.index + 1);
		else this.playing = false;
	}

	/** A song that does not load: once with a new pass (12 hours go by), then the next. */
	async #failed() {
		const track = this.current;
		if (this.radio) {
			this.problem = 'La emisora no se puede escuchar ahora';
			return;
		}
		if (!track) return;
		if (!this.#retried.has(track.id) && this.#renewPass) {
			this.#retried.add(track.id);
			const pass = await this.#renewPass();
			if (pass) {
				this.#pass = pass;
				const at = this.#audio.currentTime;
				this.#load();
				if (at) this.#audio.currentTime = at;
				return;
			}
		}
		this.problem = `«${track.title}» no se puede escuchar: ¿está la casa encendida?`;
		if (this.index + 1 < this.queue.length) this.#goTo(this.index + 1);
	}

	#stopRadio() {
		this.#hls?.destroy();
		this.#hls = null;
		if (!this.radio) return;
		this.radio = null;
		const el = this.#audio;
		el?.removeAttribute('src');
		el?.load();
	}

	#stopTracks() {
		clearTimeout(this.#handoff);
		this.#handoff = undefined;
		for (const el of this.#players) {
			el.pause();
			el.removeAttribute('src');
			el.load();
		}
	}

	#mediaSession() {
		if (!('mediaSession' in navigator)) return;
		const session = navigator.mediaSession;
		const on = (action: MediaSessionAction, handler: MediaSessionActionHandler) => {
			try {
				session.setActionHandler(action, handler);
			} catch {
				// Not that one, in this browser.
			}
		};
		on('play', () => this.toggle());
		on('pause', () => this.toggle());
		on('nexttrack', () => this.next());
		on('previoustrack', () => this.previous());
		on('seekto', (d) => d.seekTime !== undefined && this.seek(d.seekTime));
	}

	#metadata() {
		if (!('mediaSession' in navigator)) return;
		const track = this.current;
		const cover = this.radio?.favicon ?? this.cover(track);
		navigator.mediaSession.metadata = new MediaMetadata({
			title: this.radio?.name ?? track?.title ?? '',
			artist: this.radio ? 'Radio' : (track?.artist ?? ''),
			album: this.radio ? '' : (track?.album ?? ''),
			artwork: cover ? [{ src: cover, sizes: '512x512', type: 'image/jpeg' }] : []
		});
	}
}

export const roadPlayer = new RoadPlayer();
