<script lang="ts">
	import type { MusicAlbum } from '#lib/music.ts';
	import AlbumCover from './AlbumCover.svelte';

	let { albums }: { albums: MusicAlbum[] } = $props();
</script>

<div class="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
	{#each albums as a (a.id)}
		<a href="/musica/{a.id}" class="group">
			<AlbumCover album={a} class="w-full rounded-md group-hover:opacity-80" />
			<p class="mt-1 truncate text-sm">{a.title}</p>
			<p class="truncate text-xs text-zinc-400">{a.artist}</p>
		</a>
	{/each}
</div>
