<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import type { Marker, Map as MapLibre } from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	// MapLibre's worker, bundled as Vite does workers (as comun/our-map.ts).
	import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
	import type { PageProps } from './$types';

	/**
	 * A shared trip (#81): the car on the map, live (./eventos), until it is no longer shared. For
	 * whoever has the link, without an account: the map from OpenFreeMap (free, no key, and it
	 * allows this use: https://openfreemap.org), as the cloud's own needs signing in.
	 */
	let { data }: PageProps = $props();

	interface Position {
		lon: number;
		lat: number;
		t: number;
		speed: number | null;
		heading: number | null;
	}
	interface Trip {
		gone?: boolean;
		ended?: boolean;
		name?: string;
		destination?: string | null;
		arrivesAt?: number | null;
		position?: Position | null;
	}

	/** Older than this, the position is said to be old: no signal, or the tablet closed. */
	const OLD_MS = 2 * 60_000;
	const time = new Intl.DateTimeFormat('es', { timeStyle: 'short' });

	let container = $state<HTMLDivElement>();
	/** Its name as it comes live; until then, the server's. */
	let named = $state<string | null>(null);
	const title = $derived(named ?? data.title);
	let destination = $state('');
	let last = $state<Position | null>(null);
	let now = $state(Date.now());
	let over = $state(false);
	let following = $state(true);
	let map: MapLibre | undefined;

	/** «Última posición hace 20 s», kept up to date between news. */
	const age = $derived.by(() => {
		if (!last) return 'Esperando la posición…';
		const seconds = Math.round((now - last.t) / 1000);
		return `Última posición ${seconds < 60 ? `hace ${Math.max(seconds, 0)} s` : `hace ${Math.round(seconds / 60)} min`}`;
	});

	onMount(() => {
		let car: Marker | undefined;
		let events: EventSource | undefined;
		const tick = setInterval(() => (now = Date.now()), 5000);

		function show(trip: Trip) {
			if (trip.gone || trip.ended) {
				over = true;
				car?.remove();
				events?.close();
				return;
			}
			if (trip.name) named = `Viaje de ${trip.name}`;
			destination = trip.destination
				? `Va a ${trip.destination}${trip.arrivesAt ? `, llega sobre las ${time.format(trip.arrivesAt)}` : ''}`
				: '';
			if (!trip.position || !map || !car) return;
			const first = !last;
			last = trip.position;
			now = Date.now();
			car.setLngLat([last.lon, last.lat]).addTo(map);
			if (last.heading !== null && (last.speed ?? 0) > 3) car.setRotation(last.heading);
			if (first) map.jumpTo({ center: [last.lon, last.lat], zoom: 14 });
			else if (following) map.easeTo({ center: [last.lon, last.lat], duration: 1000 });
		}

		void import('maplibre-gl').then((maplibregl) => {
			maplibregl.setWorkerUrl(workerUrl);
			map = new maplibregl.Map({
				container: container!,
				style: 'https://tiles.openfreemap.org/styles/liberty',
				center: [-3.7, 40.4],
				zoom: 5,
				attributionControl: { compact: true }
			});
			map.on('dragstart', () => (following = false));
			const arrow = document.createElement('div');
			arrow.className = 'coche';
			car = new maplibregl.Marker({ element: arrow, rotationAlignment: 'map' });
			events = new EventSource(`/s/${page.params.token}/eventos`);
			events.onmessage = (e) => show(JSON.parse(e.data));
		});
		return () => {
			clearInterval(tick);
			events?.close();
			map?.remove();
		};
	});

	function center() {
		following = true;
		if (last && map)
			map.easeTo({ center: [last.lon, last.lat], zoom: Math.max(map.getZoom(), 14) });
	}
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="robots" content="noindex, nofollow" />
	<!-- What a link's preview (WhatsApp) shows: whose trip, never where. -->
	<meta property="og:title" content={data.title} />
	<meta property="og:description" content="Dónde va ahora, en el mapa, mientras lo comparte." />
</svelte:head>

<div class="fixed inset-0 bg-white text-zinc-900" style:color-scheme="light">
	<div bind:this={container} class="h-full w-full"></div>
	<section
		class="absolute top-3 right-3 left-3 max-w-[420px] rounded-2xl bg-white/95 px-4 py-3 shadow-lg"
	>
		<h1 class="mb-1 text-lg font-bold">{title}</h1>
		{#if destination}<p class="text-zinc-700">{destination}</p>{/if}
		<p class={last && now - last.t > OLD_MS ? 'text-amber-700' : 'text-zinc-700'}>{age}</p>
	</section>
	{#if !following && last && !over}
		<button
			class="absolute bottom-9 left-1/2 -translate-x-1/2 rounded-full bg-amber-500 px-6 py-2.5 font-semibold shadow-lg"
			onclick={center}>Centrar</button
		>
	{/if}
	{#if over}
		<div class="absolute inset-0 grid place-items-center bg-white/85 text-xl">
			<p>Este viaje ya no se comparte.</p>
		</div>
	{/if}
</div>

<style>
	:global(.coche) {
		width: 30px;
		height: 30px;
		background: no-repeat center / contain
			url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2 20 21 12 16.5 4 21Z' fill='%23f59e0b' stroke='white' stroke-width='1.6' stroke-linejoin='round'/%3E%3C/svg%3E");
		filter: drop-shadow(0 1px 3px rgb(0 0 0 / 0.6));
	}
</style>
