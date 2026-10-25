<script lang="ts">
	import TvHeader from '#lib/components/TvHeader.svelte';
	import SectionIcon from '#lib/components/SectionIcon.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Juegos · JellyCartoon</title>
</svelte:head>

<TvHeader title="Juegos" />

{#if !data.systems.length}
	<p class="text-zinc-400">
		No hay juegos: van en GAMES_DIR, en una carpeta por consola (snes, nes…).
	</p>
{/if}

{#each data.systems as s (s.id)}
	<section class="mb-12">
		<h2 class="mb-4 text-3xl font-semibold">{s.name}</h2>
		<div class="grid grid-cols-4 gap-6">
			{#each s.games as g (g.file)}
				<a
					href="/tv/juegos/{encodeURIComponent(g.system)}/{encodeURIComponent(g.file)}"
					class="flex items-center gap-5 rounded-2xl border-2 border-white/10 bg-zinc-900 p-5 transition duration-150 focus-visible:scale-105 focus-visible:bg-zinc-800"
				>
					<span
						class="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-lime-500/20 text-lime-300"
						><SectionIcon name="juegos" class="h-9 w-9" /></span
					>
					<span class="min-w-0 truncate text-3xl font-semibold">{g.title}</span>
				</a>
			{/each}
		</div>
	</section>
{/each}
