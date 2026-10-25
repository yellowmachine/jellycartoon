<script lang="ts">
	import GameStats from '#lib/components/GameStats.svelte';
	import TvHeader from '#lib/components/TvHeader.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Estadísticas de juegos · JellyCartoon</title>
</svelte:head>

<TvHeader title="Estadísticas de juegos" />

<GameStats stats={data.stats} links />
