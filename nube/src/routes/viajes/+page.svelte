<script lang="ts">
	import PlannedTrips from '#lib/components/PlannedTrips.svelte';
	import RouteMaps from '#lib/components/RouteMaps.svelte';
	import SavedPlaces from '#lib/components/SavedPlaces.svelte';
	import ViajesTabs from '#lib/components/ViajesTabs.svelte';
	import type { PageProps } from './$types';

	/**
	 * Viajes → Próximos: the trips still to come, and the places and routes kept with their name
	 * (#151), for the road mode and the trips' legs. Those made, in Hechos.
	 */
	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Viajes · Seilide</title>
</svelte:head>

<div class="mb-1 flex flex-wrap items-center gap-3">
	<h1 class="mr-auto text-2xl font-bold">Viajes</h1>
	<a
		href="/carretera"
		class="rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900"
		title="Para la tablet del coche: lo que suena en grande, el micrófono y nada de vídeo"
		>Modo carretera</a
	>
</div>
<ViajesTabs current="proximos" />

<PlannedTrips
	trips={data.planned}
	weather={data.weather}
	people={data.people}
	places={data.places}
	routes={data.routes}
	problems={form && ('trip' in form || 'leg' in form) ? form : null}
/>

<SavedPlaces places={data.places} routes={data.routes} map={data.map} problems={form ?? null} />

{#if data.routeMaps.map}
	<RouteMaps
		routes={data.routes}
		view={data.routeMaps}
		problem={form && 'maps' in form ? (form.maps ?? null) : null}
	/>
{/if}
