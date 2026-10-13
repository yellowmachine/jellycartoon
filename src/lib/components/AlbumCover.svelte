<script lang="ts">
	import { coverUrl } from '#lib/music.ts';

	let {
		album,
		class: className = ''
	}: { album: { id: number; hasCover: boolean }; class?: string } = $props();
</script>

{#if album.hasCover}
	<img src={coverUrl(album.id)} alt="" class="aspect-square bg-zinc-800 object-cover {className}" />
{:else}
	<div
		class="flex aspect-square items-center justify-center bg-zinc-800 text-4xl text-zinc-600 {className}"
	>
		♪
	</div>
{/if}
