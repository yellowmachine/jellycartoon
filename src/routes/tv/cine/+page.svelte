<script lang="ts">
	import TvHeader from '#lib/components/TvHeader.svelte';
	import { formatDuration } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Cine · JellyCartoon</title>
</svelte:head>

<TvHeader title="Cine" />

{#if !data.films.length}
	<p class="text-zinc-400">No hay películas listas todavía.</p>
{/if}

<div class="grid grid-cols-4 gap-8">
	{#each data.films as film (film.id)}
		<!-- Its card first: what it is, and from where to watch it. -->
		<a
			href="/tv/cine/{film.id}"
			class="group block rounded-lg transition-transform duration-150 focus-visible:scale-105"
		>
			<div class="relative aspect-video overflow-hidden rounded-lg bg-zinc-800">
				<img src="/api/movie-thumb/{film.id}" alt="" class="h-full w-full object-cover" />
				{#if film.completed}
					<span class="absolute top-2 right-2 rounded-full bg-zinc-950/80 px-3 py-1 text-lg"
						>✓ Vista</span
					>
				{:else if film.positionSec}
					<div class="absolute inset-x-0 bottom-0 h-2 bg-zinc-700">
						<div
							class="h-full bg-amber-400"
							style:width="{(film.positionSec / (film.durationSec || 1)) * 100}%"
						></div>
					</div>
				{/if}
			</div>
			<p class="mt-2 truncate font-semibold group-focus-visible:text-amber-400">{film.title}</p>
			<p class="text-xl text-zinc-400">
				{[film.year, formatDuration(film.durationSec)].filter(Boolean).join(' · ')}
			</p>
		</a>
	{/each}
</div>
