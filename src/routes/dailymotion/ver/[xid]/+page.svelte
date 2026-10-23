<script lang="ts">
	import DailymotionPlayer from '#lib/components/DailymotionPlayer.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.video.title} · Dailymotion · JellyCartoon</title>
</svelte:head>

<button onclick={() => history.back()} class="text-sm text-zinc-400 hover:text-white"
	>← Volver</button
>
<h1 class="mt-2 text-xl font-bold">{data.video.title}</h1>
<p class="mb-4 text-sm text-zinc-400">{data.video.owner}</p>

<!-- A new player for each video: the page stays the same when going from one to another. -->
{#key data.video.id}
	<DailymotionPlayer videoId={data.video.id} startSec={data.startSec} playerId={data.playerId} />
{/key}
