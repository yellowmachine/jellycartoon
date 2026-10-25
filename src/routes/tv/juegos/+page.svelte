<script lang="ts">
	import TvHeader from '#lib/components/TvHeader.svelte';
	import SectionIcon from '#lib/components/SectionIcon.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Each console in its colour, as the TV view's sections; lime for one not listed here. */
	const TONES: Record<string, { text: string; tone: string }> = {
		nes: { text: 'text-red-300', tone: 'from-red-500/45 via-rose-600/25' },
		snes: { text: 'text-violet-300', tone: 'from-violet-500/45 via-indigo-600/25' },
		gb: { text: 'text-lime-300', tone: 'from-lime-500/45 via-green-600/25' },
		gbc: { text: 'text-amber-300', tone: 'from-amber-500/45 via-orange-600/25' },
		gba: { text: 'text-indigo-300', tone: 'from-indigo-500/45 via-violet-600/25' },
		mastersystem: { text: 'text-rose-300', tone: 'from-rose-500/45 via-red-600/25' },
		megadrive: { text: 'text-sky-300', tone: 'from-sky-500/45 via-blue-600/25' }
	};
	const toneOf = (id: string) => TONES[id] ?? TONES.gb;
	const plural = (n: number) => `${n} ${n === 1 ? 'juego' : 'juegos'}`;
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

<nav class="grid grid-cols-3 gap-8">
	{#each data.systems as s (s.id)}
		{@const t = toneOf(s.id)}
		<a
			href="/tv/juegos/{encodeURIComponent(s.id)}"
			class={[
				'group relative flex h-64 flex-col justify-between overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 p-8 shadow-lg transition duration-200 focus-visible:scale-105 focus-visible:border-white/30 focus-visible:shadow-2xl',
				t.text
			]}
		>
			<!-- Its games, as captured while playing: dim, so the name reads over them. Six as a
			     mosaic; with fewer, the first one over the whole card. -->
			{#if s.images.length}
				<span
					class={[
						'absolute inset-0 grid gap-0.5 opacity-35 transition-opacity duration-200 group-focus-visible:opacity-60',
						s.images.length >= 6 && 'grid-cols-3 grid-rows-2'
					]}
					aria-hidden="true"
				>
					{#each s.images.length >= 6 ? s.images : s.images.slice(0, 1) as src (src)}
						<img {src} alt="" class="pixelated h-full w-full object-cover" />
					{/each}
				</span>
			{/if}
			<span class={['absolute inset-0 bg-gradient-to-br to-transparent', t.tone]} aria-hidden="true"
			></span>
			<span
				class="absolute inset-0 bg-gradient-to-t from-zinc-950/95 via-zinc-950/40 to-zinc-950/10"
				aria-hidden="true"
			></span>
			<SectionIcon name="juegos" class="relative h-20 w-20 drop-shadow-lg" />
			<span class="relative">
				<span class="block text-5xl font-bold text-white drop-shadow-lg">{s.name}</span>
				<span class="mt-1 block text-xl text-zinc-200">{plural(s.count)}</span>
			</span>
		</a>
	{/each}
</nav>

<style>
	.pixelated {
		image-rendering: pixelated;
	}
</style>
