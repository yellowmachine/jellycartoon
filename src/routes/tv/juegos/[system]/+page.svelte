<script lang="ts">
	import { page } from '$app/state';
	import TvHeader from '#lib/components/TvHeader.svelte';
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.name} · JellyCartoon</title>
</svelte:head>

<TvHeader title={data.name} />

<div class="grid grid-cols-4 gap-8">
	{#each data.games as g (g.file)}
		<a
			href="/tv/juegos/{encodeURIComponent(page.params.system!)}/{encodeURIComponent(g.file)}"
			class="group block rounded-lg transition-transform duration-150 focus-visible:scale-105"
		>
			<!-- Its box, whole: some are wider than tall, some taller. -->
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
			<p class="mt-2 truncate font-semibold group-focus-visible:text-lime-300">{g.title}</p>
		</a>
	{/each}
</div>
