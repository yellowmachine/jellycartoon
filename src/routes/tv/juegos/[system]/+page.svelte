<script lang="ts">
	import { page } from '$app/state';
	import TvHeader from '#lib/components/TvHeader.svelte';
	import SectionIcon from '#lib/components/SectionIcon.svelte';
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
			<!-- The capture taken while playing it, if there is one; the console's screen is 4:3. -->
			<div class="aspect-[4/3] overflow-hidden rounded-lg bg-zinc-800">
				{#if g.image}
					<img src={g.image} alt="" loading="lazy" class="pixelated h-full w-full object-cover" />
				{:else}
					<span class="flex h-full items-center justify-center text-zinc-600"
						><SectionIcon name="juegos" class="h-1/3 w-1/3" /></span
					>
				{/if}
			</div>
			<p class="mt-2 truncate font-semibold group-focus-visible:text-lime-300">{g.title}</p>
		</a>
	{/each}
</div>

<style>
	.pixelated {
		image-rendering: pixelated;
	}
</style>
