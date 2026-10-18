import { onMount, untrack } from 'svelte';
import { page } from '$app/state';
import { shownDeviceName } from '#lib/device-name.svelte.ts';
import type { QueueSave, SavedQueue } from '#lib/music.ts';
import { music } from '#lib/music-player.svelte.ts';
import type { RadioStream } from '#lib/radio.ts';

/**
 * What this browser plays, kept on the server (/api/music/queue) to go on with it after closing
 * the app, here or on another device. Only a browser that has played saves: one that only
 * brought the queue back, paused, does not overwrite what another device is playing.
 */

/** While it plays, the position is saved this often; on pause and on leaving, at once. */
const EVERY_MS = 15_000;

/** Once per page load: going between the TV view and the rest does not bring it back again. */
let restoredOnce = false;

/** As the queue says where it was saved from: «Sonaba en la TV», or the name given in Ajustes. */
function deviceName() {
	return shownDeviceName(page.url.pathname === '/tv' || page.url.pathname.startsWith('/tv/'));
}

/** The saved queue, paused, if nothing is on; when it was saved, if it was brought back. */
async function restore() {
	const saved: SavedQueue | null = await fetch('/api/music/queue')
		.then((res) => (res.ok ? res.json() : null))
		.catch(() => null);
	// Something started while it was being asked for: that one.
	if (!saved || music.current || music.radio) return null;
	let radio: RadioStream | null = null;
	if (saved.radio) {
		radio = await fetch(`/api/radio/${saved.radio}`)
			.then((res) => (res.ok ? res.json() : null))
			.catch(() => null);
		if (!radio) return null;
	}
	if (music.current || music.radio) return null;
	music.restore(saved, radio);
	return saved.updatedAt;
}

/** Call it while the component with the `<audio>` (MusicBar) is being created. */
export function keepQueue() {
	/** This browser has played since it was opened: what it has is what to save. */
	let owner = false;
	/**
	 * When its last save was made, or the one it brought back: closing the player clears only that
	 * one, so that it does not come back the next time.
	 */
	let savedAt: string | null = null;

	function snapshot(): QueueSave {
		return {
			trackIds: music.queue.map((t) => t.id),
			index: music.index,
			positionSec: untrack(() => music.positionSec),
			shuffle: music.shuffle,
			repeat: music.repeat,
			single: music.single,
			radio: music.radio?.uuid ?? null,
			changedBy: untrack(deviceName)
		};
	}

	/** Saves sent so far: only the last one's answer says when the server's copy was saved. */
	let sent = 0;

	// keepalive: the last one, from pagehide, still arrives after the page has gone.
	async function save(queue: QueueSave) {
		const mine = ++sent;
		const res = await fetch('/api/music/queue', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(queue),
			keepalive: true
		}).catch(() => null);
		// An older one answering late would leave a savedAt that is no longer the server's: closing
		// the player would then not clear the queue, and it would come back (#45).
		if (res?.ok && mine === sent) savedAt = (await res.json()).savedAt;
	}

	function clear() {
		if (savedAt)
			void fetch(`/api/music/queue?savedAt=${encodeURIComponent(savedAt)}`, {
				method: 'DELETE',
				keepalive: true
			}).catch(() => {});
		savedAt = null;
	}

	onMount(() => {
		if (!restoredOnce && !music.current && !music.radio) {
			restoredOnce = true;
			void restore().then((at) => {
				if (at) savedAt = at;
			});
		}
		const leave = () => {
			if (music.playing) void save(untrack(snapshot));
		};
		addEventListener('pagehide', leave);
		return () => removeEventListener('pagehide', leave);
	});

	// Whenever what is on changes, and on pause, with where it was.
	$effect(() => {
		const queue = snapshot();
		const playing = music.playing;
		if (playing) owner = true;
		if (!queue.trackIds.length && !queue.radio) {
			// Closed, or at the end of the queue.
			owner = false;
			clear();
			return;
		}
		if (!owner) return;
		void save(queue);
		if (!playing) return;
		const timer = setInterval(() => void save(untrack(snapshot)), EVERY_MS);
		return () => clearInterval(timer);
	});
}
