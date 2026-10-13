import type { MusicTrack, SnapcastAction, SnapcastState } from '#lib/music.ts';
import { music } from '#lib/music-player.svelte.ts';

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
		if (!snapcast) return music.play(tracks, start);
		music.pause();
		await this.send({ action: 'play', trackIds: tracks.map((t) => t.id), start });
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

/**
 * Live state of the music on Snapcast, from /api/music/snapcast/events. Call it while a component
 * is being created: the connection closes when the component goes away.
 */
export function watchSnapcast() {
	let state = $state<SnapcastState | null>(null);
	$effect(() => {
		// EventSource reconnects by itself if the connection drops.
		const source = new EventSource('/api/music/snapcast/events');
		source.onmessage = (event) => (state = JSON.parse(event.data));
		return () => source.close();
	});
	return {
		get state() {
			return state;
		}
	};
}
