<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { shownDeviceName } from '#lib/device-name.svelte.ts';

	let {
		videoId,
		startSec,
		playerId
	}: {
		videoId: string;
		/** Where it was left. */
		startSec: number;
		/** The player made in Dailymotion Studio (DAILYMOTION_PLAYER_ID). */
		playerId: string;
	} = $props();

	/**
	 * Dailymotion's own player (#66), with its library and the player made in Dailymotion Studio
	 * (https://developers.dailymotion.com/docs/player-library-script): its events say where it is,
	 * sent to /api/progress as the other players do, for where it was left and a child's time.
	 * Should it go on to a video of its own choosing, this page's route checks it again.
	 */

	/** Every this often while it plays, where it is; on pause and at the end, at once. */
	const EVERY_MS = 5000;

	interface DmState {
		videoId: string;
		videoTime: number;
		videoDuration: number;
	}
	interface DmPlayer {
		on(event: string, listener: (state: DmState) => void): void;
		pause(): void;
		destroy(): void;
	}
	interface DmLibrary {
		createPlayer(id: string, options: object): Promise<DmPlayer>;
		events: Record<string, string>;
		onScriptLoaded?: () => void;
	}

	let problem = $state<string | null>(null);

	/** The library, once per page load: loading it again would make a second one. */
	function library(playerId: string) {
		const w = window as unknown as { dailymotion?: DmLibrary };
		if (w.dailymotion?.createPlayer) return Promise.resolve(w.dailymotion);
		return new Promise<DmLibrary>((resolve, reject) => {
			const src = `https://geo.dailymotion.com/libs/player/${playerId}.js`;
			let script = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
			if (!script) {
				script = document.createElement('script');
				script.src = src;
				document.body.append(script);
			}
			script.addEventListener('load', () => resolve(w.dailymotion!));
			script.addEventListener('error', () =>
				reject(new Error('No se pudo cargar el reproductor de Dailymotion'))
			);
		});
	}

	onMount(() => {
		let player: DmPlayer | null = null;
		let sentAt = 0;
		let last: DmState | null = null;
		let gone = false;

		async function send(state: DmState, force = false) {
			last = state;
			if (!force && Date.now() - sentAt < EVERY_MS) return;
			sentAt = Date.now();
			const res = await fetch('/api/progress', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					dailymotionId: videoId,
					positionSec: state.videoTime,
					durationSec: state.videoDuration,
					device: shownDeviceName(false)
				}),
				keepalive: true
			}).catch(() => null);
			// Out of a child's time: it stops, and the rest.
			if (res?.status === 403 && !gone) {
				gone = true;
				player?.pause();
				void goto('/descanso');
			}
		}

		const leave = () => last && void send(last, true);
		addEventListener('pagehide', leave);

		library(playerId)
			.then(async (dm) => {
				if (gone) return;
				player = await dm.createPlayer('dailymotion-player', {
					video: videoId,
					params: { startTime: startSec }
				});
				player.on(dm.events.VIDEO_TIMECHANGE, (s) => void send(s));
				player.on(dm.events.VIDEO_PAUSE, (s) => void send(s, true));
				player.on(
					dm.events.VIDEO_END,
					(s) => void send({ ...s, videoTime: s.videoDuration }, true)
				);
				// It went on to another video by itself: checked again, as if it had been chosen here.
				player.on(dm.events.PLAYER_VIDEOCHANGE, (s) => {
					if (s.videoId && s.videoId !== videoId) {
						player?.pause();
						void goto(`/dailymotion/ver/${s.videoId}`, { replaceState: true });
					}
				});
			})
			.catch((err) => (problem = err instanceof Error ? err.message : String(err)));

		return () => {
			gone = true;
			leave();
			removeEventListener('pagehide', leave);
			player?.destroy();
		};
	});
</script>

<div class="aspect-video w-full overflow-hidden rounded-md bg-black">
	<div id="dailymotion-player" class="h-full w-full"></div>
</div>
{#if problem}
	<p class="mt-3 text-sm text-red-400">{problem}</p>
{/if}
