<script lang="ts">
	import 'maplibre-gl/dist/maplibre-gl.css';
	import type { GeoJSONSource, Map as MapLibreMap, Marker } from 'maplibre-gl';
	import { loadOurMap } from 'comun/our-map.ts';
	import type { LngLat } from 'comun/road.ts';

	/**
	 * Kept places and routes (#151) on the app's own map: each point with its name, a route's way,
	 * and, to choose a point, a touch on the map.
	 */
	let {
		marks = [],
		line = null,
		focus = null,
		onpick
	}: {
		/** Numbered (a route's stops) when `number` is given; amber the one being edited. */
		marks?: { at: LngLat; label: string; number?: number; current?: boolean }[];
		line?: LngLat[] | null;
		/** Looked at when it changes: what was just found. */
		focus?: LngLat | null;
		/** Touched, that point. */
		onpick?: (at: LngLat) => void;
	} = $props();

	let container = $state<HTMLDivElement>();
	let map = $state<MapLibreMap | null>(null);
	let maplibre: typeof import('maplibre-gl') | null = null;
	let problem = $state<string | null>(null);

	$effect(() => {
		const el = container;
		if (!el) return;
		let cancelled = false;
		let created: MapLibreMap | null = null;
		(async () => {
			const { maplibregl, header, styleFor } = await loadOurMap();
			if (cancelled) return;
			if (!header) return void (problem = 'No se pudo abrir el mapa.');
			maplibre = maplibregl;
			created = new maplibregl.Map({
				container: el,
				style: styleFor(true),
				center: [header.centerLon, header.centerLat],
				zoom: Math.max(header.centerZoom, 5),
				attributionControl: { compact: true }
			});
			const ready = created;
			ready.on('load', () => {
				ready.addSource('ruta', {
					type: 'geojson',
					data: { type: 'FeatureCollection', features: [] }
				});
				ready.addLayer({
					id: 'ruta',
					type: 'line',
					source: 'ruta',
					layout: { 'line-join': 'round', 'line-cap': 'round' },
					paint: { 'line-color': '#f59e0b', 'line-width': 5 }
				});
				fitted = '';
				map = ready;
			});
			ready.on('click', (e) => onpick?.([e.lngLat.lng, e.lngLat.lat]));
		})();
		return () => {
			cancelled = true;
			map = null;
			created?.remove();
		};
	});

	// The points, drawn anew when they change; all of them in view, with the way if there is one.
	let drawn: Marker[] = [];
	let fitted = '';
	$effect(() => {
		const m = map;
		const lib = maplibre;
		const points = marks;
		const way = line;
		if (!m || !lib) return;
		for (const marker of drawn) marker.remove();
		drawn = points.map((p) => {
			const el = document.createElement('div');
			el.className = p.current ? 'place-mark current' : 'place-mark';
			el.textContent = p.number !== undefined ? String(p.number) : '';
			el.title = p.label;
			return new lib.Marker({ element: el }).setLngLat(p.at).addTo(m);
		});
		m.getSource<GeoJSONSource>('ruta')?.setData(
			way && way.length > 1
				? {
						type: 'Feature',
						properties: {},
						geometry: { type: 'LineString', coordinates: way }
					}
				: { type: 'FeatureCollection', features: [] }
		);
		// Fitted again only when what is shown changes, not when the point being chosen moves: a touch
		// on the map does not zoom it out.
		const shown = JSON.stringify([points.filter((p) => !p.current).map((p) => p.at), way?.length]);
		if (shown === fitted) return;
		fitted = shown;
		const all = [...points.map((p) => p.at), ...(way ?? [])];
		if (all.length === 1) m.jumpTo({ center: all[0]!, zoom: Math.max(m.getZoom(), 14) });
		else if (all.length > 1) {
			const lons = all.map((p) => p[0]);
			const lats = all.map((p) => p[1]);
			m.fitBounds(
				[
					[Math.min(...lons), Math.min(...lats)],
					[Math.max(...lons), Math.max(...lats)]
				],
				{ padding: 40, maxZoom: 15, duration: 0 }
			);
		}
	});

	$effect(() => {
		const m = map;
		if (m && focus) m.flyTo({ center: focus, zoom: Math.max(m.getZoom(), 15) });
	});
</script>

<div class="relative h-72 w-full overflow-hidden rounded-md bg-zinc-900">
	<div bind:this={container} class={['h-full w-full', onpick && 'picking']}></div>
	{#if problem}
		<p class="absolute inset-x-3 top-3 rounded bg-zinc-950/90 p-2 text-sm text-amber-300">
			{problem}
		</p>
	{/if}
</div>

<style>
	.picking :global(.maplibregl-canvas) {
		cursor: crosshair;
	}
	:global(.place-mark) {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 9999px;
		border: 2px solid white;
		background: #0ea5e9;
		color: white;
		font:
			600 12px/1 system-ui,
			sans-serif;
		box-shadow: 0 1px 4px rgb(0 0 0 / 0.5);
	}
	:global(.place-mark.current) {
		background: #f59e0b;
		color: #18181b;
		width: 26px;
		height: 26px;
	}
</style>
