<script lang="ts">
	import GameStats from '#lib/components/GameStats.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Juegos · JellyCartoon</title>
</svelte:head>

<h1 class="mb-1 text-2xl font-bold">Juegos</h1>
<p class="mb-6 text-zinc-400">
	Lo que has jugado. Los juegos se juegan en la Vista TV, en <a
		href="/tv/juegos"
		class="text-lime-300 underline">Juegos</a
	>.
</p>

<GameStats stats={data.stats} />
