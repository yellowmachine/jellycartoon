<script lang="ts">
	import type { Snippet } from 'svelte';
	import Caracol from './Caracol.svelte';

	/**
	 * While something can't be touched (the AI reading a ticket or an invoice): the screen veiled,
	 * so nothing behind it answers a tap, and the snail in the centre, with a line under it if
	 * given. The same box as when a page is slow to open (root layout).
	 */
	let { children }: { children?: Snippet } = $props();
</script>

<div
	class="fixed inset-0 z-50 grid place-items-center bg-zinc-950/60 p-4 backdrop-blur-[2px]"
	role="status"
	aria-label="Cargando"
	aria-live="polite"
>
	<div
		class="flex max-w-xs flex-col items-center gap-3 rounded-2xl bg-zinc-900/90 p-5 text-center shadow-lg ring-1 ring-zinc-700"
	>
		<Caracol class="w-20 text-emerald-500" />
		{#if children}
			<p class="text-sm text-zinc-400">{@render children()}</p>
		{/if}
	</div>
</div>
