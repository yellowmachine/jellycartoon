<script lang="ts">
	import GameConsoles from 'comun/components/games/GameConsoles.svelte';
	import OfflineGamesPanel from '#lib/components/OfflineGamesPanel.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Juegos · Seilide</title>
</svelte:head>

<h1 class="mb-1 text-2xl font-bold">Juegos</h1>
<p class="mb-6 text-zinc-400">Los de la casa, con las mismas partidas que en la tele.</p>

{#if data.problem}
	<p class="text-amber-400">{data.problem}</p>
{:else if !data.systems.length}
	<p class="text-zinc-400">La casa no tiene juegos.</p>
{/if}

<GameConsoles systems={data.systems} />

<OfflineGamesPanel view={data.offline} problem={form?.offline ?? null} />
