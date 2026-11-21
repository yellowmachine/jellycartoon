<!--
@component
A console's games (#405), each with its box, which may come later.
-->
<script lang="ts" module>
	import type { ConsoleGame } from 'comun/games.ts';

	export interface GameListProps {
		/** The console's id, for each game's link. */
		system: string;
		/** The console's name, as the title. */
		name: string;
		/** Its games. */
		games: ConsoleGame[];
		/** Each game's box picture by its file; until it comes, an icon. */
		covers: Promise<Record<string, string>>;
	}
</script>

<script lang="ts">
	import SectionIcon from 'comun/components/SectionIcon.svelte';

	let { system, name, games, covers }: GameListProps = $props();
</script>

<a href="/juegos" class="text-sm text-zinc-400 hover:text-white">← Juegos</a>
<h1 class="mt-2 mb-6 text-2xl font-bold">{name}</h1>

<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
	{#each games as g (g.file)}
		<a href="/juegos/{encodeURIComponent(system)}/{encodeURIComponent(g.file)}" class="group block">
			<div class="aspect-square overflow-hidden rounded-lg bg-zinc-800">
				{#await covers}
					<span class="flex h-full items-center justify-center text-zinc-600"
						><SectionIcon name="juegos" class="h-1/3 w-1/3" /></span
					>
				{:then found}
					{#if found[g.file]}
						<img src={found[g.file]} alt="" loading="lazy" class="h-full w-full object-contain" />
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
