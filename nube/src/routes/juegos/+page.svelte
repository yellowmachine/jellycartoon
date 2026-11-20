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
{#if data.own}
	<p class="mb-6 text-zinc-400">Los de vuestro almacenamiento, con vuestras partidas.</p>
{:else}
	<p class="mb-6 text-zinc-400">Los de la casa, con las mismas partidas que en la tele.</p>
{/if}

{#if data.own?.problem}
	<p class="mb-4 text-amber-400">{data.own.problem}</p>
{/if}
{#if data.problem}
	<p class="text-amber-400">{data.problem}</p>
{:else if data.own && !data.systems.length}
	<p class="text-zinc-400">
		{#if data.own.scanning}
			Buscando los juegos…
		{:else}
			No hay juegos todavía. Van en una carpeta por consola (<code>nes/</code>, <code>snes/</code>,
			<code>gba/</code>, <code>megadrive/</code>…) dentro de la de los juegos.
		{/if}
	</p>
{:else if !data.systems.length}
	<p class="text-zinc-400">La casa no tiene juegos.</p>
{/if}

<GameConsoles systems={data.systems} />

<OfflineGamesPanel view={data.offline} problem={form?.offline ?? null} />
