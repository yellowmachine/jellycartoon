<script lang="ts">
	import DmVideoCard from '#lib/components/DmVideoCard.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.source.name} · Dailymotion · JellyCartoon</title>
</svelte:head>

<a href="/dailymotion" class="text-sm text-zinc-400 hover:text-white">← Dailymotion</a>
<h1 class="mt-2 mb-6 text-2xl font-bold">{data.source.name}</h1>

{#if data.videos.length}
	<ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
		{#each data.videos as video (video.id)}
			<li>
				<DmVideoCard {video} positionSec={video.positionSec} completed={video.completed} />
			</li>
		{/each}
	</ul>
{:else}
	<p class="text-zinc-400">No hay vídeos que ver aquí.</p>
{/if}

<nav class="mt-8 flex justify-center gap-3" aria-label="Páginas">
	{#if data.page > 1}
		<a
			href="?pagina={data.page - 1}"
			class="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-900">← Anteriores</a
		>
	{/if}
	{#if data.more}
		<a
			href="?pagina={data.page + 1}"
			class="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-900">Más vídeos →</a
		>
	{/if}
</nav>
