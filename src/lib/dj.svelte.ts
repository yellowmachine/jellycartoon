import type { DjOptions, MusicTrack } from '#lib/music.ts';
import { music } from '#lib/music-player.svelte.ts';
import { musicTarget } from '#lib/music-target.svelte.ts';

/**
 * Modo DJ in this browser (#117): songs at random, a few more whenever few are left, and every
 * few of them the DJ's words (dj.ts on the server), put after the song that is on while it plays.
 * On Snapcast the server does the same with its own queue.
 */

/** Fewer than this after the one on, and more are asked for; as the server's DJ_REFILL_BELOW. */
const REFILL_BELOW = 3;
/** The songs already queued that the next ones must not repeat: the last ones, not all. */
const EXCLUDE = 500;

const KEY = 'jellycartoon:dj';

async function post<T>(url: string, body: unknown): Promise<T> {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? res.statusText);
	return res.json();
}

class Dj {
	/** As it was started; it is on while the queue is still its own (`music.dj`). */
	options = $state<DjOptions | null>(null);
	/** The DJ's words being made. */
	preparing = $state(false);

	/** Songs since the DJ last spoke. */
	#played: MusicTrack[] = [];
	/** The last one followed: `step` runs on every change, and once per track is enough. */
	#seen: MusicTrack | undefined;
	#refilling = false;

	get on() {
		return music.dj && this.options !== null;
	}

	/** The last options chosen in this browser, to start with them again. */
	remembered(): DjOptions | null {
		try {
			return JSON.parse(localStorage.getItem(KEY) ?? 'null');
		} catch {
			return null;
		}
	}

	remember(options: DjOptions) {
		try {
			localStorage.setItem(KEY, JSON.stringify(options));
		} catch {
			// Private window: they are only forgotten.
		}
	}

	/** Where the music sounds now (this browser or Snapcast), remembered to start with it again. */
	async play(options: DjOptions) {
		if (musicTarget.value === 'snapcast') await post('/api/music/dj/snapcast', options);
		else await this.start(options);
		this.remember(options);
	}

	/** Instead of whatever was on, here. */
	async start(options: DjOptions) {
		const tracks = await post<MusicTrack[]>('/api/music/dj/random', {
			artists: options.artists,
			exclude: []
		});
		if (!tracks.length) throw new Error('No hay canciones de esos artistas');
		this.options = options;
		this.#played = [];
		this.#seen = undefined;
		music.play(tracks, 0, true);
	}

	/** What is queued goes on, without the DJ. */
	stop() {
		music.dj = false;
		this.options = null;
	}

	/** Whenever what is on changes (MusicBar). */
	async step() {
		const options = this.options;
		const current = music.current;
		if (!this.on || !options || !current || current === this.#seen) return;
		this.#seen = current;
		if (!current.clip) this.#played.push(current);
		await this.#refill(options);
		if (current.clip || this.#played.length < options.every || this.preparing) return;
		this.preparing = true;
		try {
			const next = music.queue[music.index + 1];
			const clip = await post<MusicTrack>('/api/music/dj/clip', {
				played: this.#played.map((t) => t.id),
				next: next && !next.clip ? next.id : null,
				lang: options.lang
			});
			// Still on that song, in the same Modo DJ: after it, and the count starts again. If not,
			// the next song tries again.
			if (music.current !== current || this.options !== options || !music.dj) return;
			music.insertNext(clip);
			this.#played = [];
		} catch {
			// Piper or the AI could not: this time without the DJ, never a silence waiting for it.
		} finally {
			this.preparing = false;
		}
	}

	async #refill(options: DjOptions) {
		if (this.#refilling || music.queue.length - music.index - 1 >= REFILL_BELOW) return;
		this.#refilling = true;
		try {
			const tracks = await post<MusicTrack[]>('/api/music/dj/random', {
				artists: options.artists,
				exclude: music.queue
					.filter((t) => !t.clip)
					.slice(-EXCLUDE)
					.map((t) => t.id)
			});
			if (this.options === options && music.dj) music.append(tracks);
		} catch {
			// Tried again at the next song.
		} finally {
			this.#refilling = false;
		}
	}
}

export const dj = new Dj();
