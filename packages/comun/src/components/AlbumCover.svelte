<!--
@component
An album's square cover, or a «♪» on grey when it has none.
-->
<script lang="ts" module>
	export interface AlbumCoverProps {
		/** The album: its own `cover` address, or the library's when `hasCover`. */
		album: { id: number; hasCover: boolean; cover?: string };
		/** Extra classes for the image (or its placeholder), e.g. its size. */
		class?: string;
	}
</script>

<script lang="ts">
	import { coverUrl } from '../music.ts';

	let { album, class: className = '' }: AlbumCoverProps = $props();
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
