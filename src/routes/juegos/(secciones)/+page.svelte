<script lang="ts">
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const plural = (n: number) => `${n} ${n === 1 ? 'juego' : 'juegos'}`;
</script>

<svelte:head>
	<title>Juegos · JellyCartoon</title>
</svelte:head>

{#if !data.systems.length}
	<p class="text-zinc-400">No hay juegos: van en GAMES_DIR, en una carpeta por consola.</p>
{/if}

<nav class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
	{#each data.systems as s (s.id)}
		<a
			href="/juegos/{encodeURIComponent(s.id)}"
			class="group relative flex h-36 flex-col justify-end overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 p-4 hover:border-lime-400/60"
		>
			{#if s.images.length}
				<span
					class={[
						'absolute inset-0 grid opacity-35 group-hover:opacity-50',
						s.images.length >= 6 && 'grid-cols-3 grid-rows-2'
					]}
					aria-hidden="true"
				>
					{#each s.images.length >= 6 ? s.images : s.images.slice(0, 1) as src (src)}
						<img {src} alt="" class="h-full w-full object-cover" />
					{/each}
				</span>
			{/if}
			<span
				class="absolute inset-0 bg-gradient-to-t from-zinc-950/95 to-transparent"
				aria-hidden="true"
			></span>
			<SectionIcon name="juegos" class="absolute top-3 left-3 h-7 w-7 text-lime-300" />
			<span class="relative font-bold">{s.name}</span>
			<span class="relative text-sm text-zinc-300">{plural(s.count)}</span>
		</a>
	{/each}
</nav>
