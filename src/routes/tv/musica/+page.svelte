<script lang="ts">
	import TvHeader from '#lib/components/TvHeader.svelte';
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import { formatRemaining } from 'comun/format.ts';
	import { coverUrl } from 'comun/music.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Música · JellyCartoon</title>
</svelte:head>

<TvHeader title="Música" />

<!-- The playlists first: there are a few, and the albums can be many presses long. -->
{#if data.playlists.length}
	<section class="mb-12">
		<h2 class="mb-4 text-3xl font-semibold">Listas</h2>
		<div class="grid grid-cols-4 gap-6">
			{#each data.playlists as p (p.id)}
				<a
					href="/tv/musica/listas/{p.id}"
					class="flex items-center gap-5 rounded-2xl border-2 border-white/10 bg-zinc-900 p-5 transition duration-150 focus-visible:scale-105 focus-visible:bg-zinc-800"
				>
					<span
						class="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-violet-500/20 text-violet-300"
						><SectionIcon name="musica" class="h-9 w-9" /></span
					>
					<span class="min-w-0">
						<span class="block truncate text-3xl font-semibold">{p.name}</span>
						<span class="block truncate text-xl text-zinc-400"
							>{p.total}
							{p.total === 1 ? 'canción' : 'canciones'} · {formatRemaining(p.durationSec)}</span
						>
					</span>
				</a>
			{/each}
		</div>
	</section>
{/if}

<section>
	<h2 class="mb-4 text-3xl font-semibold">Álbumes</h2>
	{#if !data.albums.length}
		<p class="text-zinc-400">No hay música lista todavía.</p>
	{/if}
	<div class="grid grid-cols-6 gap-8">
		{#each data.albums as a (a.id)}
			<a
				href="/tv/musica/{a.id}"
				class="group block rounded-lg transition-transform duration-150 focus-visible:scale-105"
			>
				<div class="aspect-square overflow-hidden rounded-lg bg-zinc-800">
					{#if a.hasCover}
						<img src={coverUrl(a.id)} alt="" loading="lazy" class="h-full w-full object-cover" />
					{:else}
						<span class="flex h-full items-center justify-center text-zinc-600"
							><SectionIcon name="musica" class="h-1/3 w-1/3" /></span
						>
					{/if}
				</div>
				<p class="mt-2 truncate font-semibold group-focus-visible:text-violet-300">{a.title}</p>
				<p class="truncate text-xl text-zinc-400">{a.artist}</p>
			</a>
		{/each}
	</div>
</section>
