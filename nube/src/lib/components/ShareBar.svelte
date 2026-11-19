<script lang="ts">
	import { tripShare } from '#lib/trip-share.svelte.ts';

	/**
	 * The trip shared from this browser outside the road mode (#550, «comparte el viaje con mamá» from
	 * Hablar): always in sight while it goes on, with its way out. The road mode shows its own.
	 */
</script>

{#if tripShare.url}
	<div
		class="flex items-center gap-3 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm"
		role="status"
	>
		<span class="min-w-0 flex-1">📍 Compartes por dónde vas, en directo</span>
		<button
			class="shrink-0 rounded-md border border-zinc-700 px-3 py-1 hover:bg-zinc-800"
			onclick={() => void tripShare.stop()}>Dejar de compartir</button
		>
	</div>
{/if}
