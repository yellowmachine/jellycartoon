<script lang="ts">
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { untrack } from 'svelte';
	import type { GeoJSONSource, Map as MapLibreMap, Marker } from 'maplibre-gl';
	import { loadOurMap } from 'comun/our-map.ts';
	import type { LngLat, Route } from 'comun/road.ts';

	/**
	 * The road mode's map (#78, phase 3a): Spain's map served by the app itself (DATA_DIR/mapa, see
	 * scripts/mapa.sh) with MapLibre (https://maplibre.org), and where we are, from the browser's
	 * GPS, the map following it and turning with the way we go. Dragging it stops following until
	 * «Recentrar».
	 */

	let {
		route = null,
		destination = null,
		onposition
	}: {
		/** Drawn, and the map fitted to it when it is new (phase 3b). */
		route?: Route | null;
		destination?: LngLat | null;
		/** Each position the GPS gives, for the route to start from it; its speed in m/s, if known. */
		onposition?: (at: LngLat, speed: number | null) => void;
	} = $props();

	/** Moving faster than this (m/s, ~11 km/h), the heading is the way we go; slower, it jumps. */
	const HEADING_SPEED = 3;
	const FOLLOW_ZOOM = 16;

	let container = $state<HTMLDivElement>();
	let map: MapLibreMap | null = null;
	let me: Marker | null = null;
	/** The map exists, its style loaded: what places the arrow and the route waits for it. */
	let ready = $state(false);
	/** Each time a style is loaded (light or dark): the route is drawn on it again. */
	let styleLoads = $state(0);

	/**
	 * Light by day; dark at night, not to dazzle. Remembered in this browser. The map's own style,
	 * not the app's theme.
	 */
	const LIGHT_KEY = 'carretera-mapa-claro';
	let light = $state(true);
	$effect(() => {
		try {
			light = localStorage.getItem(LIGHT_KEY) !== 'no';
		} catch {
			// Private windows: light.
		}
	});
	function setLight(value: boolean) {
		light = value;
		try {
			if (value) localStorage.removeItem(LIGHT_KEY);
			else localStorage.setItem(LIGHT_KEY, 'no');
		} catch {
			// Same.
		}
	}
	/** Set once the map exists: its style, light or dark. */
	let restyle: ((light: boolean) => void) | null = null;
	let flag: Marker | null = null;
	let following = $state(true);
	/** The last one the GPS gave, as plain values (a GeolocationPosition's are getters). */
	let position = $state<{
		latitude: number;
		longitude: number;
		heading: number | null;
		speed: number | null;
	} | null>(null);
	let problem = $state<string | null>(null);

	// The map: its libraries only here, where it is shown.
	$effect(() => {
		const el = container;
		if (!el) return;
		let cancelled = false;
		(async () => {
			const { maplibregl, header, styleFor } = await loadOurMap();
			if (cancelled) return;
			if (!header) {
				problem = 'No se pudo abrir el mapa.';
				return;
			}
			const created = new maplibregl.Map({
				container: el,
				center: [header.centerLon, header.centerLat],
				zoom: header.centerZoom,
				attributionControl: { compact: true },
				style: styleFor(untrack(() => light))
			});
			map = created;
			// Moved by hand: it stops following.
			created.on('dragstart', () => {
				following = false;
				clearTimeout(refollow);
			});

			const arrow = document.createElement('div');
			arrow.className = 'road-map-me';
			arrow.setAttribute('aria-label', 'Estás aquí');
			me = new maplibregl.Marker({ element: arrow, rotationAlignment: 'map' });
			flag = new maplibregl.Marker({ color: '#f59e0b' });
			// Whole, not by differences: «style.load» comes again, and the route with it.
			restyle = (light) => created.setStyle(styleFor(light), { diff: false });
			// Its first style and each one after (light, dark): the route's layers on it, under the
			// arrow; its data comes with each route, and again with each style.
			created.on('style.load', () => {
				created.addSource('ruta', {
					type: 'geojson',
					data: { type: 'FeatureCollection', features: [] },
					attribution: '© <a href="https://openrouteservice.org">openrouteservice.org</a> by HeiGIT'
				});
				created.addLayer({
					id: 'ruta-borde',
					type: 'line',
					source: 'ruta',
					layout: { 'line-join': 'round', 'line-cap': 'round' },
					paint: { 'line-color': '#78350f', 'line-width': 11 }
				});
				created.addLayer({
					id: 'ruta',
					type: 'line',
					source: 'ruta',
					layout: { 'line-join': 'round', 'line-cap': 'round' },
					paint: { 'line-color': '#f59e0b', 'line-width': 7 }
				});
				ready = true;
				styleLoads++;
			});
		})();
		return () => {
			cancelled = true;
			ready = false;
			restyle = null;
			clearTimeout(refollow);
			map?.remove();
			map = null;
			me = null;
			flag = null;
		};
	});

	// Where we are, as the GPS says it: https://developer.mozilla.org/docs/Web/API/Geolocation_API
	$effect(() => {
		if (!('geolocation' in navigator)) {
			problem = 'Este navegador no da la posición.';
			return;
		}
		const watch = navigator.geolocation.watchPosition(
			({ coords }) => {
				const { latitude, longitude, heading, speed } = coords;
				position = { latitude, longitude, heading, speed };
				problem = null;
				onposition?.([longitude, latitude], speed);
			},
			(err) => {
				problem =
					err.code === err.PERMISSION_DENIED
						? 'Sin permiso para la posición: dáselo a la página en el navegador.'
						: 'Buscando la posición…';
			},
			{ enableHighAccuracy: true, maximumAge: 2000 }
		);
		return () => navigator.geolocation.clearWatch(watch);
	});

	// The arrow, and the map with it while following.
	$effect(() => {
		const pos = position;
		if (!pos || !ready || !map || !me) return;
		const { latitude, longitude, heading, speed } = pos;
		const moving = heading !== null && !Number.isNaN(heading) && (speed ?? 0) > HEADING_SPEED;
		me.setLngLat([longitude, latitude]);
		if (moving) me.setRotation(heading!);
		if (!me.getElement().isConnected) me.addTo(map);
		if (!following) return;
		map.easeTo({
			center: [longitude, latitude],
			zoom: Math.max(map.getZoom(), FOLLOW_ZOOM),
			bearing: moving ? heading! : map.getBearing(),
			duration: 1000
		});
	});

	/** How long the whole route stays in view before following us again. */
	const OVERVIEW_MS = 5000;
	let refollow: ReturnType<typeof setTimeout> | undefined;
	/** The destination last fitted: a route recalculated on the way is not shown whole again. */
	let fitted: string | null = null;

	// A route: drawn, with its flag. To a new destination, the whole of it in view for a moment,
	// then following us again (unless the map was moved by hand). None, gone.
	$effect(() => {
		const line = route?.line;
		const to = destination;
		void styleLoads;
		if (!ready || !map || !flag) return;
		const source = map.getSource<GeoJSONSource>('ruta');
		source?.setData({
			type: 'FeatureCollection',
			features: line
				? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } }]
				: []
		});
		if (to) flag.setLngLat(to).addTo(map);
		else flag.remove();
		const key = to ? to.join() : null;
		if (!key) fitted = null;
		if (!line?.length || key === fitted) return;
		fitted = key;
		const lons = line.map((p) => p[0]);
		const lats = line.map((p) => p[1]);
		following = false;
		clearTimeout(refollow);
		refollow = setTimeout(recenter, OVERVIEW_MS);
		map.fitBounds(
			[
				[Math.min(...lons), Math.min(...lats)],
				[Math.max(...lons), Math.max(...lats)]
			],
			{ padding: 60, bearing: 0, duration: 1000 }
		);
	});

	// Light or dark, as chosen: the map's style changed, the rest stays.
	let styled: boolean | null = null;
	$effect(() => {
		const value = light;
		if (!ready || !restyle) return;
		if (styled === null) styled = untrack(() => light);
		if (value === styled) return;
		styled = value;
		restyle(value);
	});

	function recenter() {
		following = true;
		// The next position moves it; this one, now.
		if (position) position = { ...position };
	}
</script>

<div class="relative h-full w-full overflow-hidden rounded-3xl bg-zinc-900">
	<div bind:this={container} class="h-full w-full"></div>
	<!-- Below the top: the road mode writes where to there. -->
	{#if problem}
		<p class="absolute inset-x-3 top-20 rounded-xl bg-zinc-950/90 p-3 text-lg text-amber-300">
			{problem}
		</p>
	{/if}
	<button
		class="absolute bottom-10 left-3 rounded-full bg-zinc-950/80 px-4 py-2 text-lg text-zinc-100 shadow-lg active:scale-95"
		aria-pressed={!light}
		title={light ? 'Mapa oscuro, para la noche' : 'Mapa claro'}
		onclick={() => setLight(!light)}>{light ? '☾ Oscuro' : '☀ Claro'}</button
	>
	{#if !following && position}
		<button
			class="absolute bottom-10 left-1/2 -translate-x-1/2 rounded-full bg-amber-500 px-6 py-3 text-xl font-semibold text-zinc-950 shadow-xl active:scale-95"
			onclick={recenter}>Recentrar</button
		>
	{/if}
</div>

<style>
	/* Where we are: an arrow pointing the way we go (the marker turns with the heading). */
	:global(.road-map-me) {
		width: 34px;
		height: 34px;
		background: no-repeat center / contain
			url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2 20 21 12 16.5 4 21Z' fill='%23f59e0b' stroke='white' stroke-width='1.6' stroke-linejoin='round'/%3E%3C/svg%3E");
		filter: drop-shadow(0 1px 3px rgb(0 0 0 / 0.6));
	}
</style>
