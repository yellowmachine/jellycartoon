<script lang="ts">
	import TvHeader from '#lib/components/TvHeader.svelte';
	import { thumbUrl } from 'comun/thumb.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Series · JellyCartoon</title>
</svelte:head>

<TvHeader title="Series" />

{#if !data.series.length}
	<p class="text-zinc-400">No hay series listas todavía.</p>
{/if}

<div class="grid grid-cols-4 gap-8">
	{#each data.series as s (s.id)}
		<a
			href="/tv/series/{s.id}"
			class="group block rounded-lg transition-transform duration-150 focus-visible:scale-105"
		>
			<div class="aspect-video overflow-hidden rounded-lg bg-zinc-800">
				{#if s.cover}
					<img src={thumbUrl(s.cover)} alt="" class="h-full w-full object-cover" />
				{/if}
			</div>
			<p class="mt-2 truncate font-semibold group-focus-visible:text-amber-400">{s.title}</p>
			<p class="text-xl text-zinc-400">{s.ready} capítulos</p>
		</a>
	{/each}
</div>
