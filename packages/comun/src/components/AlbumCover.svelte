<script lang="ts">
	import { coverUrl } from '../music.ts';

	let {
		album,
		class: className = ''
	}: { album: { id: number; hasCover: boolean; cover?: string }; class?: string } = $props();
</script>

<!-- Its own cover (Seilide's «Tu música», #534), or the library's. -->
{#if album.cover || album.hasCover}
	<img
		src={album.cover ?? coverUrl(album.id)}
		alt=""
		class="aspect-square bg-zinc-800 object-cover {className}"
	/>
{:else}
	<div
		class="flex aspect-square items-center justify-center bg-zinc-800 text-4xl text-zinc-600 {className}"
	>
		♪
	</div>
{/if}
