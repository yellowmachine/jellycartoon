<script lang="ts">
	import type { Snippet } from 'svelte';
	import MusicQueue from 'comun/components/MusicQueue.svelte';
	import { snapcastQueueSource } from '#lib/snapcast-queue.svelte.ts';

	/** Música → Cola with Snapcast's queue: the same view, its rows from the house's mpv. */
	let { children }: { children?: Snippet } = $props();
	const source = snapcastQueueSource();
</script>

<MusicQueue {source}>
	{@render children?.()}
	{#if source.problem}
		<p class="mt-2 text-sm text-red-400">{source.problem}</p>
	{/if}
</MusicQueue>
