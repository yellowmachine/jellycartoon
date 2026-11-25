<script lang="ts">
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { loadOurMap } from 'comun/our-map.ts';
	import type { StoredPoint } from '#lib/trips.ts';

	/**
	 * A kept trip (#81) on the app's own map: its way, from start (green) to end (red), and its photos
	 * where they were taken (touched, shown).
	 */
	let {
		line = [],
		pieces,
		coloured,
		marks = [],
		photos = [],
		photoBase = '/viajes/fotos',
		openMap = false,
		ends = true
	}: {
		line?: StoredPoint[];
		/** Its way in pieces, instead of `line`: a shared walk's, without its ends (#434). */
		pieces?: [number, number][][];
		/** Its way in pieces of their own colour (a day's, #613), drawn in order. */
		coloured?: { line: [number, number][]; color: string }[];
		/** What was made on the way: a photo, a recording or words, shown when touched. */
		marks?: {
			position: [number, number];
			text: string;
			photo: string | null;
			audio: string | null;
		}[];
		photos?: { id: number; lon: number | null; lat: number | null }[];
		/** Where the photos are: a trip's, unless said. */
		photoBase?: string;
		/**
		 * OpenFreeMap's (free, no key, it allows this use: https://openfreemap.org), for whoever has a
		 * link and no session: the cloud's own needs signing in (as /s/, #81).
		 */
		openMap?: boolean;
		/** Where it started and ended, marked: not on a way without its ends, they would point at them. */
		ends?: boolean;
	} = $props();

	let container = $state<HTMLDivElement>();
	let problem = $state<string | null>(null);

	$effect(() => {
		const el = container;
		const drawn = (
			coloured ??
			(pieces ?? [line.map((p): [number, number] => [p[0], p[1]])]).map((w) => ({
				line: w,
				color: '#f59e0b'
			}))
		).filter((w) => w.line.length);
		const ways = drawn.map((w) => w.line);
		const points = ways.flat();
		if (!el || !points.length) return;
		let cancelled = false;
		let map: import('maplibre-gl').Map | null = null;
		(async () => {
			let maplibregl: typeof import('maplibre-gl');
			let style: import('maplibre-gl').StyleSpecification | string;
			if (openMap) {
				const [lib, { default: workerUrl }] = await Promise.all([
					import('maplibre-gl'),
					import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url')
				]);
				maplibregl = lib;
				maplibregl.setWorkerUrl(workerUrl);
				style = 'https://tiles.openfreemap.org/styles/liberty';
			} else {
				const ours = await loadOurMap();
				if (cancelled) return;
				if (!ours.header) return void (problem = 'No se pudo abrir el mapa.');
				maplibregl = ours.maplibregl;
				style = ours.styleFor(true);
			}
			if (cancelled) return;
			const seen = [...points, ...marks.map((m) => m.position)];
			const lons = seen.map((p) => p[0]);
			const lats = seen.map((p) => p[1]);
			map = new maplibregl.Map({
				container: el,
				style,
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
						type: 'FeatureCollection',
						features: drawn
							.filter((w) => w.line.length > 1)
							.map(({ line, color }) => ({
								type: 'Feature',
								properties: { color },
								geometry: { type: 'LineString', coordinates: line }
							}))
					}
				});
				created.addLayer({
					id: 'viaje',
					type: 'line',
					source: 'viaje',
					layout: { 'line-join': 'round', 'line-cap': 'round' },
					paint: { 'line-color': ['get', 'color'], 'line-width': 5 }
				});
			});
			if (ends) {
				new maplibregl.Marker({ color: '#22c55e' }).setLngLat(points[0]!).addTo(created);
				new maplibregl.Marker({ color: '#ef4444' }).setLngLat(points.at(-1)!).addTo(created);
			}
			for (const photo of photos) {
				if (photo.lon === null || photo.lat === null) continue;
				const img = document.createElement('img');
				img.src = `${photoBase}/${photo.id}`;
				img.alt = '';
				img.className = 'trip-photo';
				new maplibregl.Marker({ color: '#0ea5e9', scale: 0.8 })
					.setLngLat([photo.lon, photo.lat])
					.setPopup(new maplibregl.Popup({ offset: 24, maxWidth: '320px' }).setDOMContent(img))
					.addTo(created);
			}
			for (const mark of marks) {
				const box = document.createElement('div');
				box.className = 'trip-mark';
				if (mark.photo) {
					const img = document.createElement('img');
					img.src = mark.photo;
					img.alt = '';
					img.className = 'trip-photo';
					box.append(img);
				}
				if (mark.text) {
					const p = document.createElement('p');
					p.textContent = mark.text;
					box.append(p);
				}
				if (mark.audio) {
					const audio = document.createElement('audio');
					audio.controls = true;
					audio.preload = 'none';
					audio.src = mark.audio;
					box.append(audio);
				}
				new maplibregl.Marker({ color: mark.photo ? '#0ea5e9' : '#a855f7', scale: 0.8 })
					.setLngLat(mark.position)
					.setPopup(new maplibregl.Popup({ offset: 24, maxWidth: '320px' }).setDOMContent(box))
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
	:global(.trip-mark) {
		max-width: 280px;
		color: #18181b;
		white-space: pre-wrap;
	}
	:global(.trip-mark audio) {
		width: 260px;
		max-width: 70vw;
	}
</style>
