<script lang="ts">
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import { routeMaps } from 'comun/route-maps.svelte.ts';
	import { offlineGames } from '#lib/offline-games.svelte.ts';
	import { offlineGameHref } from '#lib/offline-games.ts';

	const ready = $derived(offlineGames.games.filter((g) => offlineGames.isReady(g)));
	const coming = $derived(offlineGames.games.filter((g) => !offlineGames.isReady(g)));
</script>

<svelte:head>
	<title>Juegos sin conexión · Seilide</title>
</svelte:head>

<a href="/juegos" class="text-sm text-zinc-400 hover:text-white">← Juegos</a>
<h1 class="mt-2 mb-1 text-2xl font-bold">Sin conexión</h1>
<p class="mb-6 text-zinc-400">
	Los juegos guardados en {routeMaps.device ? `«${routeMaps.device.name}»` : 'este dispositivo'}: se
	juegan aunque no haya cobertura.
</p>

{#if !ready.length && !coming.length}
	<p class="text-zinc-400">
		Este dispositivo no lleva juegos. Elige uno en Juegos y dale a «Llevar» con este dispositivo.
	</p>
{/if}

<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
	{#each ready as g (`${g.system}/${g.file}`)}
		<a href={offlineGameHref(g.system, g.file)} class="group block">
			<div class="aspect-square overflow-hidden rounded-lg bg-zinc-800">
				{#if g.cover}
					<img src={g.cover} alt="" loading="lazy" class="h-full w-full object-contain" />
				{:else}
					<span class="flex h-full items-center justify-center text-zinc-600"
						><SectionIcon name="juegos" class="h-1/3 w-1/3" /></span
					>
				{/if}
			</div>
			<p class="mt-1 truncate text-sm group-hover:text-lime-300">{g.title}</p>
			<p class="truncate text-xs text-zinc-500">{g.consoleName}</p>
		</a>
	{/each}
</div>

{#if coming.length}
	<h2 class="mt-8 mb-2 font-semibold">Todavía bajando</h2>
	<ul class="flex flex-col gap-1 text-sm text-zinc-400">
		{#each coming as g (`${g.system}/${g.file}`)}
			{@const now =
				offlineGames.current?.system === g.system && offlineGames.current.file === g.file
					? offlineGames.current
					: null}
			<li>
				{g.title} · {g.consoleName}
				{#if now}<span class="text-amber-300"> · {now.held} de {now.total} ficheros</span>{/if}
			</li>
		{/each}
	</ul>
	<p class="mt-2 text-xs text-zinc-500">Se bajan con la app abierta y con cobertura.</p>
{/if}
