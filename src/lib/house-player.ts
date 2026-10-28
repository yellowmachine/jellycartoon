import { goto } from '$app/navigation';
import { page } from '$app/state';
import type { PlayerLinks } from 'comun/components/Player.svelte';
import { shownDeviceName } from 'comun/device-name.svelte.ts';
import { videoHere } from '#lib/video-here.svelte.ts';

/**
 * What the house lends the episodes' player (comun's Player, #253): its own HLS, where it is and
 * the person's choices saved here, the microphone and the kitchen knowing it plays, and a child's
 * time over (#18).
 */

export function houseLinks(episodeId: number): PlayerLinks {
	return {
		hls: `/api/hls/${episodeId}`,
		saveProgress: (at) =>
			// keepalive lets the request finish even if the page is being closed.
			fetch('/api/progress', {
				method: 'POST',
				keepalive: true,
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					...at,
					// Where, for a child's: /infantil says «Lucía está viendo… en el móvil».
					device: shownDeviceName(page.url.pathname.startsWith('/tv'))
				})
			}).catch(() => null),
		saveSettings: (values) =>
			fetch('/api/settings', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(values)
			}).catch(() => null)
	};
}

/** For the header's microphone: what plays here, to pause it while someone speaks. */
export function playsAtHome(episodeId: number, title: string) {
	return (element: HTMLVideoElement, handOver: () => void) => {
		videoHere.set({ episodeId, title, element, handOver });
		return () => videoHere.clear(element);
	};
}

/** Out of a child's time (#18) the server refuses the video's pieces: the notice says why. */
export const outOfTime = () => void goto('/descanso');
