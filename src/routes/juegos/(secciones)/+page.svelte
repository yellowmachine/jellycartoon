<script lang="ts">
	import GameConsoles from 'comun/components/games/GameConsoles.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Juegos · JellyCartoon</title>
</svelte:head>

{#if !data.systems.length}
	<p class="text-zinc-400">No hay juegos: van en GAMES_DIR, en una carpeta por consola.</p>
{/if}

<GameConsoles systems={data.systems} />
