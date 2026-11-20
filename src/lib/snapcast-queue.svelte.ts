import type { QueueSource } from 'comun/components/MusicQueue.svelte';
import type { SnapcastQueue } from 'comun/music.ts';
import { musicTarget, watchSnapcast } from 'comun/music-target.svelte.ts';

/**
 * Música → Cola on Snapcast: its queue (/api/music/snapcast/cola), asked again when the live state
 * says the song, the number of songs or the shuffle changed, and after each change made here. Call
 * it while a component is being created, as watchSnapcast.
 */
export function snapcastQueueSource(): QueueSource & { readonly problem: string | null } {
	const live = watchSnapcast();
	let queue = $state<SnapcastQueue>({ items: [], index: -1, radio: false });
	let problem = $state<string | null>(null);

	async function load() {
		const res = await fetch('/api/music/snapcast/cola').catch(() => null);
		const body = await res?.json().catch(() => null);
		if (!res?.ok) {
			problem = body?.message ?? 'Sin conexión';
			return;
		}
		problem = null;
		queue = body;
	}

	// What changes the queue or the one on; not the position, which comes every second.
	const changes = $derived.by(() => {
		const s = live.state;
		return JSON.stringify([
			s?.available,
			s?.playlistPos,
			s?.playlistCount,
			s?.shuffle,
			s?.track?.id,
			s?.radio?.uuid
		]);
	});
	$effect(() => {
		void changes;
		void load();
	});

	return {
		get rows() {
			return queue.items;
		},
		get index() {
			return queue.index;
		},
		get radio() {
			return queue.radio;
		},
		get problem() {
			return problem;
		},
		jumpTo: (entryId) => void musicTarget.send({ action: 'jump', entryId }).then(load),
		remove: (entryId) => void musicTarget.send({ action: 'removeEntry', entryId }).then(load),
		async move(entryId, beforeId) {
			await musicTarget.send({ action: 'moveEntry', entryId, beforeId });
			await load();
			return musicTarget.error;
		}
	};
}
