<script lang="ts">
	import GameStats from '#lib/components/GameStats.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Juegos · JellyCartoon</title>
</svelte:head>

<GameStats stats={data.stats} />
