<script lang="ts">
	import { enhance } from '$app/forms';
	import RouteMaps from '#lib/components/RouteMaps.svelte';
	import SavedPlaces from '#lib/components/SavedPlaces.svelte';
	import TripMap from '#lib/components/TripMap.svelte';
	import { distanceText } from 'comun/road.ts';
	import { durationText, type StoredPoint } from '#lib/trips.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const day = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short' });
	const time = new Intl.DateTimeFormat('es', { timeStyle: 'short' });
	/** «Octubre de 2026»: only its first letter up. */
	const monthLabel = (month: string) => {
		const text = monthName.format(new Date(`${month}-01T00:00:00Z`));
		return text.charAt(0).toUpperCase() + text.slice(1);
	};
	const monthName = new Intl.DateTimeFormat('es', {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	});

	const seconds = (t: { startedAt: Date; endedAt: Date }) =>
		(new Date(t.endedAt).getTime() - new Date(t.startedAt).getTime()) / 1000;
	/** km/h. */
	const kmh = (metres: number, secs: number) => (secs > 0 ? Math.round((metres / secs) * 3.6) : 0);

	const thisMonth = $derived(data.stats[0]);
	const year = $derived(
		data.stats.reduce(
			(sum, m) => ({
				trips: sum.trips + m.trips,
				distance: sum.distance + m.distance,
				seconds: sum.seconds + m.seconds
			}),
			{ trips: 0, distance: 0, seconds: 0 }
		)
	);

	/** The trip opened, and its way once it comes. */
	let opened = $state<number | null>(null);
	let line = $state<StoredPoint[] | null>(null);
	let photosOfTrip = $state<{ id: number; lon: number | null; lat: number | null }[]>([]);
	async function open(id: number) {
		if (opened === id) return void (opened = null);
		opened = id;
		line = null;
		const res = await fetch(`/viajes/${id}/recorrido`).catch(() => null);
		if (opened !== id || !res?.ok) return;
		const body = await res.json();
		photosOfTrip = body.photos;
		line = body.line;
	}

	/**
	 * The last trip, first: back home, what was just kept is what is wanted. Its way and its photos
	 * come by themselves.
	 */
	const latest = $derived(data.trips[0]);
	let latestLine = $state<StoredPoint[] | null>(null);
	let latestPhotos = $state<{ id: number; lon: number | null; lat: number | null }[]>([]);
	$effect(() => {
		const id = latest?.id;
		latestLine = null;
		latestPhotos = [];
		if (id === undefined) return;
		let gone = false;
		void fetch(`/viajes/${id}/recorrido`)
			.then((res) => (res.ok ? res.json() : null))
			.then((body) => {
				if (gone || !body) return;
				latestPhotos = body.photos;
				latestLine = body.line;
			})
			.catch(() => {});
		return () => (gone = true);
	});

	/** «Borrar todos», asked twice, without a dialog. */
	let sure = $state(false);
</script>

<svelte:head>
	<title>Viajes · Nube</title>
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
<p class="mb-6 text-sm text-zinc-400">
	Lo que guarda el modo carretera de tus viajes, solo para ti.
	{#if data.recordTrips}
		Se guardan mientras está abierto; se dejan de guardar en
		<a href="/ajustes?seccion=mi#viajes" class="text-amber-400 hover:underline">Ajustes</a>.
	{:else}
		Ahora no se guardan: se activa en <a
			href="/ajustes?seccion=mi#viajes"
			class="text-amber-400 hover:underline">Ajustes</a
		> («Guardar mis viajes»).
	{/if}
</p>

<SavedPlaces places={data.places} routes={data.routes} map={data.map} problems={form ?? null} />

{#if data.routeMaps.map}
	<RouteMaps
		routes={data.routes}
		view={data.routeMaps}
		problem={form && 'maps' in form ? (form.maps ?? null) : null}
	/>
{/if}

{#if latest}
	<section class="mb-8 rounded-md border border-amber-500/40 p-4">
		<p class="text-sm text-amber-300">Último viaje</p>
		<p class="text-lg font-semibold">
			{day.format(new Date(latest.startedAt))}, {time.format(
				new Date(latest.startedAt)
			)}–{time.format(new Date(latest.endedAt))}{latest.destination
				? ` · a ${latest.destination}`
				: ''}
		</p>
		<p class="mb-3 text-sm text-zinc-300">
			{distanceText(latest.distance)} · {durationText(seconds(latest))} · {kmh(
				latest.distance,
				seconds(latest)
			)} km/h de media{latest.maxSpeed ? ` · máx. ${Math.round(latest.maxSpeed * 3.6)} km/h` : ''}
		</p>
		{#if !data.map}
			<p class="text-sm text-zinc-400">No hay mapa (scripts/mapa.sh).</p>
		{:else if latestLine}
			<TripMap line={latestLine} photos={latestPhotos} />
		{:else}
			<p class="text-sm text-zinc-400">Cargando el recorrido…</p>
		{/if}
		{#if latestPhotos.length}
			<div class="mt-3 flex gap-2 overflow-x-auto">
				{#each latestPhotos as photo (photo.id)}
					<a href="/viajes/fotos/{photo.id}" target="_blank" rel="noopener" class="shrink-0">
						<img
							src="/viajes/fotos/{photo.id}"
							alt="Foto de este viaje"
							loading="lazy"
							class="h-24 w-36 rounded object-cover"
						/>
					</a>
				{/each}
			</div>
		{/if}
	</section>
{/if}

{#if data.stats.length}
	<section class="mb-8 grid gap-4 sm:grid-cols-2">
		{#each [{ label: 'Este mes', s: thisMonth }, { label: 'Últimos 12 meses', s: year }] as box (box.label)}
			{#if box.s}
				<div class="rounded-md border border-zinc-800 p-4">
					<p class="mb-2 text-sm text-zinc-400">{box.label}</p>
					<p class="text-2xl font-semibold">{distanceText(box.s.distance)}</p>
					<p class="text-sm text-zinc-300">
						{box.s.trips}
						{box.s.trips === 1 ? 'viaje' : 'viajes'} · {durationText(box.s.seconds)} al volante · {kmh(
							box.s.distance,
							box.s.seconds
						)} km/h de media
					</p>
				</div>
			{/if}
		{/each}
	</section>

	<table class="mb-8 w-full max-w-xl text-sm">
		<thead class="text-left text-zinc-400">
			<tr
				><th class="py-1 font-normal">Mes</th><th class="font-normal">Viajes</th><th
					class="font-normal">Distancia</th
				><th class="font-normal">Al volante</th></tr
			>
		</thead>
		<tbody>
			{#each data.stats as m (m.month)}
				<tr class="border-t border-zinc-800">
					<td class="py-1.5">{monthLabel(m.month)}</td>
					<td>{m.trips}</td>
					<td>{distanceText(m.distance)}</td>
					<td>{durationText(m.seconds)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}

{#if data.trips.length}
	<ul class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
		{#each data.trips as t (t.id)}
			<li class="p-3">
				<div class="flex flex-wrap items-center gap-x-4 gap-y-1">
					<button class="min-w-0 flex-1 text-left hover:text-amber-300" onclick={() => open(t.id)}>
						<span class="block font-medium">
							{day.format(new Date(t.startedAt))}, {time.format(
								new Date(t.startedAt)
							)}–{time.format(new Date(t.endedAt))}{t.destination ? ` · a ${t.destination}` : ''}
						</span>
						<span class="block text-sm text-zinc-400">
							{distanceText(t.distance)} · {durationText(seconds(t))} · {kmh(
								t.distance,
								seconds(t)
							)} km/h de media{t.maxSpeed ? ` · máx. ${Math.round(t.maxSpeed * 3.6)} km/h` : ''}
						</span>
					</button>
					<form method="post" action="?/delete" use:enhance>
						<input type="hidden" name="id" value={t.id} />
						<button class="text-sm text-zinc-500 hover:text-red-400">Borrar</button>
					</form>
				</div>
				{#if opened === t.id}
					<div class="mt-3">
						{#if !data.map}
							<p class="text-sm text-zinc-400">No hay mapa (scripts/mapa.sh).</p>
						{:else if line}
							<TripMap {line} photos={photosOfTrip} />
						{:else}
							<p class="text-sm text-zinc-400">Cargando el recorrido…</p>
						{/if}
					</div>
				{/if}
			</li>
		{/each}
	</ul>

	<form method="post" action="?/deleteAll" use:enhance class="mt-6">
		{#if sure}
			<span class="mr-2 text-sm text-red-300">Se borran todos, sin vuelta atrás.</span>
			<button class="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500"
				>Sí, borrar todos</button
			>
			<button type="button" class="ml-2 text-sm text-zinc-400" onclick={() => (sure = false)}
				>No</button
			>
		{:else}
			<button
				type="button"
				class="text-sm text-zinc-500 hover:text-red-400"
				onclick={() => (sure = true)}>Borrar todos mis viajes</button
			>
		{/if}
	</form>
{:else}
	<p class="text-zinc-400">Todavía no hay viajes guardados.</p>
{/if}

{#if data.photos.length}
	<!-- The photos taken from the road mode (📷, or «haz una foto»). -->
	<h2 class="mt-10 mb-3 text-xl font-semibold">Fotos</h2>
	<ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
		{#each data.photos as photo (photo.id)}
			<li class="overflow-hidden rounded-md border border-zinc-800">
				<a href="/viajes/fotos/{photo.id}" target="_blank" rel="noopener">
					<img
						src="/viajes/fotos/{photo.id}"
						alt=""
						loading="lazy"
						class="aspect-video w-full bg-zinc-900 object-cover"
					/>
				</a>
				<div class="flex items-center justify-between gap-2 px-2 py-1.5 text-xs text-zinc-400">
					<span>{day.format(new Date(photo.takenAt))}, {time.format(new Date(photo.takenAt))}</span>
					<form method="post" action="?/deletePhoto" use:enhance>
						<input type="hidden" name="id" value={photo.id} />
						<button class="hover:text-red-400">Borrar</button>
					</form>
				</div>
			</li>
		{/each}
	</ul>
{/if}
