<script lang="ts">
	import { page } from '$app/state';
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import Caracol from '#lib/components/Caracol.svelte';
	import { routeMaps } from 'comun/route-maps.svelte.ts';
	import { offlineGames } from '#lib/offline-games.svelte.ts';
	import { offlineMusic } from '#lib/offline-music.svelte.ts';
	import { backTo } from '#lib/offline-pages.ts';

	const games = $derived(offlineGames.games.filter((g) => offlineGames.isReady(g)).length);
	const lists = $derived(offlineMusic.lists.length);
	const maps = $derived(routeMaps.held.length);
	/** Carretera, with the lists it carries and the map along the routes it keeps. */
	const road = $derived(
		[
			lists === 1 ? '1 lista' : lists ? `${lists} listas` : '',
			maps === 1 ? 'el mapa de 1 ruta' : maps ? `el mapa de ${maps} rutas` : ''
		]
			.filter(Boolean)
			.join(' y ')
	);

	/** Where it was going, again: a full load, for the network's page. */
	function retry() {
		location.assign(backTo(page.url.searchParams.get('desde')));
	}
</script>

<svelte:head>
	<title>Sin conexión · Seilide</title>
</svelte:head>

<svelte:window ononline={retry} />

<Caracol class="mb-4 w-28 text-emerald-500" />
<h1 class="mb-1 text-2xl font-bold">Sin conexión</h1>
<p class="mb-6 text-zinc-400">Ahora no llega la conexión con Seilide.</p>

{#if games || road}
	<p class="mb-3">Lo que este dispositivo lleva sí funciona:</p>
	<div class="flex flex-col gap-3">
		{#if road}
			<!-- Loaded whole: its kept page is the service worker's, not the server's data. -->
			<a
				href="/carretera"
				data-sveltekit-reload
				class="flex items-center gap-3 rounded-lg bg-zinc-800 p-4 hover:bg-zinc-700"
			>
				<SectionIcon name="viajes" class="h-8 w-8 text-lime-300" />
				<span>
					<span class="block font-semibold">Carretera</span>
					<span class="text-sm text-zinc-400">Con {road}</span>
				</span>
			</a>
		{/if}
		{#if games}
			<a
				href="/juegos/aqui"
				class="flex items-center gap-3 rounded-lg bg-zinc-800 p-4 hover:bg-zinc-700"
			>
				<SectionIcon name="juegos" class="h-8 w-8 text-lime-300" />
				<span>
					<span class="block font-semibold">Juegos</span>
					<span class="text-sm text-zinc-400">
						{games === 1 ? '1 juego' : `${games} juegos`} en este dispositivo
					</span>
				</span>
			</a>
		{/if}
	</div>
{:else}
	<p class="text-zinc-400">Este dispositivo no lleva nada para usar sin conexión.</p>
{/if}

<button
	type="button"
	onclick={retry}
	class="mt-8 rounded-lg bg-lime-400 px-4 py-2 font-semibold text-zinc-950 hover:bg-lime-300"
>
	Volver a intentarlo
</button>
