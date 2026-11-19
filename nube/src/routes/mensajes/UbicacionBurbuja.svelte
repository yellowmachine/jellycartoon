<script lang="ts">
	import PlacesMap from '#lib/components/PlacesMap.svelte';
	import type { Place } from '#lib/mensajes/messenger.ts';

	/**
	 * Mensajes (#555): where someone was, on the app's own map (its tiles come from Seilide, so no one
	 * else learns the place); and to open it in the phone's maps app, only when touched.
	 */
	let { place, mine }: { place: Place; mine: boolean } = $props();

	const elsewhere = $derived.by(() => {
		const { lat, lon } = place;
		const ua = navigator.userAgent;
		if (/android/i.test(ua)) return `geo:${lat},${lon}?q=${lat},${lon}`;
		if (/iphone|ipad|mac os/i.test(ua))
			return `https://maps.apple.com/?ll=${lat},${lon}&q=${lat},${lon}`;
		return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
	});
</script>

<span class="block w-64 max-w-full">
	<PlacesMap
		marks={[{ at: [place.lon, place.lat], label: 'Aquí', current: true }]}
		height="h-40"
		still
	/>
	<span class="mt-1 flex items-center justify-between gap-2 text-sm">
		<span>
			📍 {mine ? 'Tu ubicación' : 'Ubicación'}
			{#if place.accuracy !== undefined}<span class="opacity-70">{` · ± ${place.accuracy} m`}</span
				>{/if}
		</span>
		<a class="underline" href={elsewhere} target="_blank" rel="noopener noreferrer">Abrir</a>
	</span>
	<span class="block text-[10px] opacity-60">Protomaps © colaboradores de OpenStreetMap</span>
</span>
