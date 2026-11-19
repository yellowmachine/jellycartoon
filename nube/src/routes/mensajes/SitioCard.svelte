<script lang="ts">
	import type { Snippet } from 'svelte';
	import PlacesMap from '#lib/components/PlacesMap.svelte';

	/**
	 * A kept place (#555): on the app's own map (its tiles from Seilide, so nobody else learns it),
	 * its name and address, with whatever may be done with it (`children`).
	 */
	let {
		place,
		children
	}: {
		place: { name: string; lat: number; lon: number; address: string | null };
		children?: Snippet;
	} = $props();
</script>

<div class="rounded-xl border border-zinc-700 bg-zinc-900/80 p-3">
	<PlacesMap
		marks={[{ at: [place.lon, place.lat], label: place.name, current: true }]}
		height="h-40"
		still
	/>
	<p class="text-[10px] text-zinc-500">Protomaps © colaboradores de OpenStreetMap</p>
	<p class="mt-1 font-semibold">📌 {place.name}</p>
	{#if place.address}<p class="text-sm text-zinc-400">{place.address}</p>{/if}
	{#if children}<div class="mt-3 flex flex-wrap items-center gap-2">{@render children()}</div>{/if}
</div>
