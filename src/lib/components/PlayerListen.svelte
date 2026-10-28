<script lang="ts">
	import { page } from '$app/state';
	import type { PlayerMenu } from 'comun/components/Player.svelte';
	import { listenToEpisode } from 'comun/episode-listening.svelte.ts';
	import SnapcastListen from './SnapcastListen.svelte';

	/**
	 * First in the player's ⚙ menu, the house's: «Seguir solo con el audio» (#154) and, with
	 * Snapcast, its audio on the house's speakers (#223). Not for a child's account.
	 */
	let { menu }: { menu: PlayerMenu } = $props();

	/**
	 * «Seguir solo con el audio» (#154): from this second, with the audio being heard, in the music
	 * player, which goes on with the screen off (Chrome pauses a video then). The video stops here.
	 */
	function onlyAudio() {
		const video = menu.video();
		if (!video) return;
		// «Friends · T1 E2 · El de la boda»: the episode's title, and the rest under it.
		const parts = menu.title.split(' · ');
		listenToEpisode({
			id: menu.episodeId,
			title: parts.length > 1 ? parts.at(-1)! : menu.title,
			subtitle: parts.length > 1 ? parts.slice(0, -1).join(' · ') : 'Solo el audio',
			audioTracks: menu.audioTracks,
			lang: null,
			track: menu.audioIndex(),
			durationSec: Number.isFinite(video.duration) ? video.duration : null,
			positionSec: video.currentTime
		});
		menu.handOver();
	}
</script>

{#if !page.data.kid && menu.audioTracks.length}
	<button
		class="w-full rounded px-2 py-1.5 text-left text-zinc-300 hover:bg-zinc-800"
		title="Sigue desde aquí en el reproductor de música, que no se para con la pantalla apagada"
		onclick={onlyAudio}>🎧 Seguir solo con el audio</button
	>
	{#if page.data.snapcast}
		<SnapcastListen
			episodeId={menu.episodeId}
			startSec={() => menu.video()?.currentTime ?? null}
			itemClass="w-full rounded px-2 py-1.5 text-left text-zinc-300 hover:bg-zinc-800"
			onsent={menu.handOver}
		/>
	{/if}
{/if}
