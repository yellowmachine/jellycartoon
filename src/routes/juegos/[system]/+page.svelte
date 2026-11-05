<script lang="ts">
	import { page } from '$app/state';
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.name} · Juegos · JellyCartoon</title>
</svelte:head>

<a href="/juegos" class="text-sm text-zinc-400 hover:text-white">← Juegos</a>
<h1 class="mt-2 mb-6 text-2xl font-bold">{data.name}</h1>

<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
	{#each data.games as g (g.file)}
		<a
			href="/juegos/{encodeURIComponent(page.params.system!)}/{encodeURIComponent(g.file)}"
			class="group block"
		>
			<div class="aspect-square overflow-hidden rounded-lg bg-zinc-800">
				{#await data.covers}
					<span class="flex h-full items-center justify-center text-zinc-600"
						><SectionIcon name="juegos" class="h-1/3 w-1/3" /></span
					>
				{:then covers}
					{#if covers[g.file]}
						<img src={covers[g.file]} alt="" loading="lazy" class="h-full w-full object-contain" />
					{:else}
						<span class="flex h-full items-center justify-center text-zinc-600"
							><SectionIcon name="juegos" class="h-1/3 w-1/3" /></span
						>
					{/if}
				{/await}
			</div>
			<p class="mt-1 truncate text-sm group-hover:text-lime-300">{g.title}</p>
		</a>
	{/each}
</div>
