<script lang="ts">
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { loadOurMap } from 'comun/our-map.ts';
	import type { StoredPoint } from '#lib/trips.ts';

	/**
	 * A kept trip (#81) on the app's own map: its way, from start (green) to end (red), and its photos
	 * where they were taken (touched, shown).
	 */
	let {
		line,
		photos = []
	}: { line: StoredPoint[]; photos?: { id: number; lon: number | null; lat: number | null }[] } =
		$props();

	let container = $state<HTMLDivElement>();
	let problem = $state<string | null>(null);

	$effect(() => {
		const el = container;
		const points = line.map((p): [number, number] => [p[0], p[1]]);
		if (!el || !points.length) return;
		let cancelled = false;
		let map: import('maplibre-gl').Map | null = null;
		(async () => {
			const { maplibregl, header, styleFor } = await loadOurMap();
			if (cancelled) return;
			if (!header) return void (problem = 'No se pudo abrir el mapa.');
			const lons = points.map((p) => p[0]);
			const lats = points.map((p) => p[1]);
			map = new maplibregl.Map({
				container: el,
				style: styleFor(true),
				bounds: [
					[Math.min(...lons), Math.min(...lats)],
					[Math.max(...lons), Math.max(...lats)]
				],
				fitBoundsOptions: { padding: 40 },
				attributionControl: { compact: true }
			});
			const created = map;
			created.on('load', () => {
				created.addSource('viaje', {
					type: 'geojson',
					data: {
						type: 'Feature',
						properties: {},
						geometry: { type: 'LineString', coordinates: points }
					}
				});
				created.addLayer({
					id: 'viaje',
					type: 'line',
					source: 'viaje',
					layout: { 'line-join': 'round', 'line-cap': 'round' },
					paint: { 'line-color': '#f59e0b', 'line-width': 5 }
				});
			});
			new maplibregl.Marker({ color: '#22c55e' }).setLngLat(points[0]!).addTo(created);
			new maplibregl.Marker({ color: '#ef4444' }).setLngLat(points.at(-1)!).addTo(created);
			for (const photo of photos) {
				if (photo.lon === null || photo.lat === null) continue;
				const img = document.createElement('img');
				img.src = `/viajes/fotos/${photo.id}`;
				img.alt = '';
				img.className = 'trip-photo';
				new maplibregl.Marker({ color: '#0ea5e9', scale: 0.8 })
					.setLngLat([photo.lon, photo.lat])
					.setPopup(new maplibregl.Popup({ offset: 24, maxWidth: '320px' }).setDOMContent(img))
					.addTo(created);
			}
		})();
		return () => {
			cancelled = true;
			map?.remove();
		};
	});
</script>

<div class="relative h-72 w-full overflow-hidden rounded-md bg-zinc-900">
	<div bind:this={container} class="h-full w-full"></div>
	{#if problem}
		<p class="absolute inset-x-3 top-3 rounded bg-zinc-950/90 p-2 text-sm text-amber-300">
			{problem}
		</p>
	{/if}
</div>

<style>
	:global(.trip-photo) {
		display: block;
		width: 280px;
		max-width: 70vw;
		border-radius: 6px;
	}
</style>
