<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import PlacesMap from '#lib/components/PlacesMap.svelte';
	import PointFinder from '#lib/components/PointFinder.svelte';
	import { distanceText, type LngLat } from 'comun/road.ts';
	import {
		MAX_STOPS,
		type RouteStop,
		type SavedPlace,
		type SavedRoute
	} from 'comun/saved-places.ts';
	import { durationText } from '#lib/trips.ts';

	/**
	 * «Mis sitios» and «Mis rutas» (#151): places and routes kept with their name, for the road mode
	 * and the voice. Each found by searching, by coordinates pasted, or by a touch on the map.
	 */
	let {
		places,
		routes,
		map,
		problems
	}: {
		places: SavedPlace[];
		routes: SavedRoute[];
		/** There is a map (scripts/mapa.sh). */
		map: boolean;
		/** Why the last one was not kept, from the server. */
		problems: { place?: string; route?: string } | null;
	} = $props();

	type PlaceDraft = { id: number | null; name: string; at: LngLat | null; address: string | null };
	type RouteDraft = { id: number | null; name: string; stops: RouteStop[]; line: LngLat[] | null };

	let place = $state<PlaceDraft | null>(null);
	let route = $state<RouteDraft | null>(null);
	let busy = $state(false);
	/** Asked twice, without a dialog: «Borrar» and then «Sí, borrar». */
	let deleting = $state<string | null>(null);

	function editPlace(p: SavedPlace | null) {
		route = null;
		place = p
			? { id: p.id, name: p.name, at: p.at, address: p.address }
			: { id: null, name: '', at: null, address: null };
	}

	function editRoute(r: SavedRoute | null) {
		place = null;
		route = r
			? { id: r.id, name: r.name, stops: r.stops.map((s) => ({ ...s })), line: r.line }
			: { id: null, name: '', stops: [], line: null };
	}

	/** Closed once kept; open with its problem otherwise. */
	const closeOnSuccess: SubmitFunction = () => {
		busy = true;
		return async ({ result, update }) => {
			busy = false;
			deleting = null;
			if (result.type === 'success') {
				place = null;
				route = null;
			}
			await update({ reset: false });
		};
	};

	/** Changed, its way is no longer the one kept: asked again when kept. */
	function changeStops(stops: RouteStop[]) {
		if (!route) return;
		route.stops = stops;
		route.line = null;
	}

	function addStop(stop: RouteStop) {
		if (!route || route.stops.length >= MAX_STOPS) return;
		changeStops([...route.stops, stop]);
	}

	function move(i: number, by: number) {
		if (!route) return;
		const stops = [...route.stops];
		const [stop] = stops.splice(i, 1);
		stops.splice(i + by, 0, stop!);
		changeStops(stops);
	}

	const roles = (i: number, n: number) => (i === 0 ? 'Salida' : i === n - 1 ? 'Llegada' : 'Por');

	/** What the map shows: the one being edited, or all of them. */
	const marks = $derived(
		route
			? route.stops.map((s, i) => ({ at: s.at, label: s.name, number: i + 1 }))
			: place
				? [
						...places.filter((p) => p.id !== place!.id).map((p) => ({ at: p.at, label: p.name })),
						...(place.at
							? [{ at: place.at, label: place.name || 'Nuevo sitio', current: true }]
							: [])
					]
				: places.map((p) => ({ at: p.at, label: p.name }))
	);
	let focus = $state<LngLat | null>(null);

	function picked(at: LngLat) {
		if (place) {
			place.at = at;
			place.address = null;
		} else if (route) addStop({ name: `Punto ${route.stops.length + 1}`, at });
	}

	let chosenPlace = $state('');
</script>

<section class="mb-10">
	<div class="mb-3 flex flex-wrap items-center gap-3">
		<h2 class="mr-auto text-xl font-semibold">Mis sitios y rutas</h2>
		<button
			class="rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900"
			onclick={() => editPlace(null)}>Añadir sitio</button
		>
		<button
			class="rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900"
			onclick={() => editRoute(null)}>Añadir ruta</button
		>
	</div>
	<p class="mb-4 text-sm text-zinc-400">
		Salen los primeros en el modo carretera, y se pueden pedir por su nombre: «llévame a casa», «la
		ruta del trabajo».
	</p>

	<div class="grid gap-6 lg:grid-cols-2">
		<div class="flex flex-col gap-6">
			{#if place}
				<form
					method="post"
					action="?/savePlace"
					use:enhance={closeOnSuccess}
					class="flex flex-col gap-3 rounded-md border border-amber-500/40 p-4"
				>
					<p class="text-sm text-amber-300">{place.id === null ? 'Nuevo sitio' : 'Editar sitio'}</p>
					<input type="hidden" name="id" value={place.id ?? ''} />
					<input type="hidden" name="lon" value={place.at?.[0] ?? ''} />
					<input type="hidden" name="lat" value={place.at?.[1] ?? ''} />
					<input type="hidden" name="address" value={place.address ?? ''} />
					<label class="flex flex-col gap-1 text-sm">
						Nombre
						<input
							name="name"
							bind:value={place.name}
							required
							maxlength="60"
							placeholder="Casa, Trabajo, Centro comercial…"
							class="rounded-md border-zinc-700 bg-zinc-950 px-3 py-1.5"
						/>
					</label>
					<div class="flex flex-col gap-1 text-sm">
						Dónde
						<PointFinder
							onfound={(p) => {
								place!.at = p.at;
								place!.address = p.address;
								focus = p.at;
								if (!place!.name && p.address) place!.name = p.address.split(',')[0]!;
							}}
						/>
						{#if place.at}
							<p class="text-xs text-zinc-400">
								{place.address ?? `${place.at[1].toFixed(5)}, ${place.at[0].toFixed(5)}`}
							</p>
						{:else if map}
							<p class="text-xs text-zinc-500">O toca el mapa donde está.</p>
						{/if}
					</div>
					{#if problems?.place}
						<p class="text-sm text-red-300">{problems.place}</p>
					{/if}
					<div class="flex gap-2">
						<button
							class="rounded-md bg-amber-500 px-4 py-1.5 text-sm font-semibold text-zinc-950 disabled:opacity-50"
							disabled={busy || !place.at || !place.name.trim()}>Guardar</button
						>
						<button
							type="button"
							class="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200"
							onclick={() => (place = null)}>Cancelar</button
						>
					</div>
				</form>
			{/if}

			{#if route}
				<form
					method="post"
					action="?/saveRoute"
					use:enhance={closeOnSuccess}
					class="flex flex-col gap-3 rounded-md border border-amber-500/40 p-4"
				>
					<p class="text-sm text-amber-300">{route.id === null ? 'Nueva ruta' : 'Editar ruta'}</p>
					<input type="hidden" name="id" value={route.id ?? ''} />
					<input type="hidden" name="stops" value={JSON.stringify(route.stops)} />
					<label class="flex flex-col gap-1 text-sm">
						Nombre
						<input
							name="name"
							bind:value={route.name}
							required
							maxlength="60"
							placeholder="Al trabajo por la ronda, A casa de los abuelos…"
							class="rounded-md border-zinc-700 bg-zinc-950 px-3 py-1.5"
						/>
					</label>

					<ol class="flex flex-col gap-2">
						{#each route.stops as stop, i (i)}
							<li class="flex items-center gap-2 rounded-md bg-zinc-900 px-2 py-1.5 text-sm">
								<span
									class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500 text-xs font-semibold text-white"
									>{i + 1}</span
								>
								<span class="w-14 shrink-0 text-xs text-zinc-400"
									>{roles(i, route.stops.length)}</span
								>
								{#if stop.placeId !== undefined}
									<span class="min-w-0 flex-1 truncate">{stop.name}</span>
								{:else}
									<input
										bind:value={stop.name}
										aria-label="Nombre de la parada {i + 1}"
										class="min-w-0 flex-1 rounded border-zinc-700 bg-zinc-950 px-2 py-0.5 text-sm"
									/>
								{/if}
								<button
									type="button"
									class="px-1 text-zinc-400 hover:text-zinc-100 disabled:opacity-30"
									aria-label="Subir"
									disabled={i === 0}
									onclick={() => move(i, -1)}>↑</button
								>
								<button
									type="button"
									class="px-1 text-zinc-400 hover:text-zinc-100 disabled:opacity-30"
									aria-label="Bajar"
									disabled={i === route.stops.length - 1}
									onclick={() => move(i, 1)}>↓</button
								>
								<button
									type="button"
									class="px-1 text-zinc-500 hover:text-red-400"
									aria-label="Quitar"
									onclick={() => changeStops(route!.stops.filter((_, j) => j !== i))}>✕</button
								>
							</li>
						{:else}
							<li class="text-sm text-zinc-400">
								Añade la salida, los puntos por los que quieres pasar y la llegada, en orden.
							</li>
						{/each}
					</ol>

					{#if route.stops.length < MAX_STOPS}
						<div class="flex flex-col gap-2 rounded-md border border-zinc-800 p-3 text-sm">
							<p class="text-zinc-300">Añadir parada</p>
							{#if places.length}
								<div class="flex gap-2">
									<select
										bind:value={chosenPlace}
										aria-label="Uno de mis sitios"
										class="min-w-0 flex-1 rounded-md border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
									>
										<option value="">Uno de mis sitios…</option>
										{#each places as p (p.id)}
											<option value={String(p.id)}>{p.name}</option>
										{/each}
									</select>
									<button
										type="button"
										class="rounded-md border border-zinc-700 px-3 py-1.5 hover:bg-zinc-900 disabled:opacity-50"
										disabled={!chosenPlace}
										onclick={() => {
											const p = places.find((x) => String(x.id) === chosenPlace);
											if (p) addStop({ name: p.name, at: p.at, placeId: p.id });
											chosenPlace = '';
										}}>Añadir</button
									>
								</div>
							{/if}
							<PointFinder
								placeholder="U otro: búscalo, o pega coordenadas o un enlace"
								onfound={(p) => {
									addStop({
										name: p.address?.split(',')[0] ?? `Punto ${route!.stops.length + 1}`,
										at: p.at
									});
									focus = p.at;
								}}
							/>
							{#if map}
								<p class="text-xs text-zinc-500">O toca el mapa: se añade al final.</p>
							{/if}
						</div>
					{/if}

					{#if problems?.route}
						<p class="text-sm text-red-300">{problems.route}</p>
					{/if}
					<div class="flex items-center gap-2">
						<button
							class="rounded-md bg-amber-500 px-4 py-1.5 text-sm font-semibold text-zinc-950 disabled:opacity-50"
							disabled={busy || route.stops.length < 2 || !route.name.trim()}
							>{busy ? 'Calculando la ruta…' : 'Guardar'}</button
						>
						<button
							type="button"
							class="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200"
							onclick={() => (route = null)}>Cancelar</button
						>
					</div>
				</form>
			{/if}

			<div>
				<h3 class="mb-2 text-sm text-zinc-400">Sitios</h3>
				{#if places.length}
					<ul class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
						{#each places as p (p.id)}
							<li class="flex items-center gap-3 p-3">
								<button
									class="min-w-0 flex-1 text-left hover:text-amber-300"
									onclick={() => editPlace(p)}
								>
									<span class="block font-medium">{p.name}</span>
									<span class="block truncate text-sm text-zinc-400"
										>{p.address ?? `${p.at[1].toFixed(5)}, ${p.at[0].toFixed(5)}`}</span
									>
								</button>
								<form method="post" action="?/deletePlace" use:enhance={closeOnSuccess}>
									<input type="hidden" name="id" value={p.id} />
									{#if deleting === `place-${p.id}`}
										<button class="text-sm text-red-400">Sí, borrar</button>
										<button
											type="button"
											class="ml-2 text-sm text-zinc-400"
											onclick={() => (deleting = null)}>No</button
										>
									{:else}
										<button
											type="button"
											class="text-sm text-zinc-500 hover:text-red-400"
											onclick={() => (deleting = `place-${p.id}`)}>Borrar</button
										>
									{/if}
								</form>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="text-sm text-zinc-500">Todavía no hay sitios guardados.</p>
				{/if}
			</div>

			<div>
				<h3 class="mb-2 text-sm text-zinc-400">Rutas</h3>
				{#if routes.length}
					<ul class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
						{#each routes as r (r.id)}
							<li class="flex items-center gap-3 p-3">
								<button
									class="min-w-0 flex-1 text-left hover:text-amber-300"
									onclick={() => editRoute(r)}
								>
									<span class="block font-medium">{r.name}</span>
									<span class="block truncate text-sm text-zinc-400"
										>{r.stops.map((s) => s.name).join(' → ')}</span
									>
									<span class="block text-sm text-zinc-500"
										>{distanceText(r.distance)} · {durationText(r.duration)}</span
									>
								</button>
								<form method="post" action="?/deleteRoute" use:enhance={closeOnSuccess}>
									<input type="hidden" name="id" value={r.id} />
									{#if deleting === `route-${r.id}`}
										<button class="text-sm text-red-400">Sí, borrar</button>
										<button
											type="button"
											class="ml-2 text-sm text-zinc-400"
											onclick={() => (deleting = null)}>No</button
										>
									{:else}
										<button
											type="button"
											class="text-sm text-zinc-500 hover:text-red-400"
											onclick={() => (deleting = `route-${r.id}`)}>Borrar</button
										>
									{/if}
								</form>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="text-sm text-zinc-500">Todavía no hay rutas guardadas.</p>
				{/if}
			</div>
		</div>

		{#if map}
			<div class="lg:sticky lg:top-4 lg:self-start">
				<PlacesMap
					{marks}
					line={route?.line ?? null}
					{focus}
					onpick={place || route ? picked : undefined}
				/>
				{#if route && !route.line && route.stops.length >= 2}
					<p class="mt-2 text-xs text-zinc-500">El camino se calcula al guardar.</p>
				{/if}
			</div>
		{/if}
	</div>
</section>
