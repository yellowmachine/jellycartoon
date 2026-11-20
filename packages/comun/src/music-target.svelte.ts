import { goto } from '$app/navigation';
import { page } from '$app/state';
import type { MusicTrack, SnapcastAction, SnapcastState } from './music.ts';
import { music } from './music-player.svelte.ts';

/**
 * Something put on from the Música pages, here (Reproducir, Mezclar, a song, Modo DJ…): to its
 * Cola tab, to see what plays and what comes next, here or on Snapcast (whose Cola shows mpv's).
 * Not from elsewhere (the road mode, the voice).
 */
export function showQueue() {
	const path = page.url.pathname;
	if (path.startsWith('/musica') && !path.startsWith('/musica/cola')) void goto('/musica/cola');
}

/**
 * Where albums sound when played from the Música pages: this device's browser, or Snapcast.
 * Remembered per device, so the phone and the PC can each have their own.
 */

const KEY = 'jellycartoon:music-target';

function stored(): 'here' | 'snapcast' {
	try {
		return localStorage.getItem(KEY) === 'snapcast' ? 'snapcast' : 'here';
	} catch {
		return 'here';
	}
}

class MusicTarget {
	value = $state<'here' | 'snapcast'>(typeof window === 'undefined' ? 'here' : stored());
	/** The last command to Snapcast that failed, e.g. its mpv is not running. */
	error = $state<string | null>(null);

	set(value: 'here' | 'snapcast') {
		this.value = value;
		try {
			localStorage.setItem(KEY, value);
		} catch {
			// Private window: it is only forgotten.
		}
	}

	/** The tracks, starting at `start`, where they are to sound. */
	async play(tracks: MusicTrack[], start = 0, snapcast = this.value === 'snapcast') {
		if (!snapcast) {
			music.play(tracks, start);
			showQueue();
			return;
		}
		music.pause();
		await this.send({ action: 'play', trackIds: tracks.map((t) => t.id), start });
		if (!this.error) showQueue();
	}

	/** A radio station: its stream is asked for when it is played, on the server for Snapcast. */
	async playRadio(uuid: string, snapcast = this.value === 'snapcast') {
		if (snapcast) {
			music.stop();
			return this.send({ action: 'radio', uuid });
		}
		const res = await fetch(`/api/radio/${uuid}`).catch(() => null);
		if (!res?.ok) {
			this.error = (await res?.json().catch(() => null))?.message ?? 'Sin conexión';
			return;
		}
		this.error = null;
		music.playRadio(await res.json());
	}

	async append(tracks: MusicTrack[], snapcast = this.value === 'snapcast') {
		if (!snapcast) return music.append(tracks);
		await this.send({ action: 'append', trackIds: tracks.map((t) => t.id) });
	}

	async send(action: SnapcastAction) {
		const res = await fetch('/api/music/snapcast', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(action)
		}).catch(() => null);
		this.error = res?.ok
			? null
			: ((await res?.json().catch(() => null))?.message ?? 'Sin conexión');
	}
}

export const musicTarget = new MusicTarget();

/** One connection for every component that watches Snapcast: the bar and the Música background. */
let snapcastState = $state<SnapcastState | null>(null);
let watchers = 0;
let source: EventSource | null = null;

/**
 * Live state of the music on Snapcast, from /api/music/snapcast/events. Call it while a component
 * is being created: the connection closes when the last component watching goes away.
 */
export function watchSnapcast() {
	$effect(() => {
		// EventSource reconnects by itself if the connection drops.
		if (watchers++ === 0) {
			source = new EventSource('/api/music/snapcast/events');
			source.onmessage = (event) => (snapcastState = JSON.parse(event.data));
		}
		return () => {
			if (--watchers > 0) return;
			source?.close();
			source = null;
			snapcastState = null;
		};
	});
	return {
		get state() {
			return snapcastState;
		}
	};
}
