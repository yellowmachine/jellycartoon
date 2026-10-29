<script lang="ts">
	import { enhance } from '$app/forms';
	import PointFinder from '#lib/components/PointFinder.svelte';
	import { dayName, localDay, type AgendaPerson } from 'comun/agenda.ts';
	import { distanceText, type LngLat } from 'comun/road.ts';
	import type { SavedPlace, SavedRoute } from 'comun/saved-places.ts';
	import { FORECAST_DAYS, skyIcon, type HourWeather } from 'comun/weather.ts';
	import { durationText } from '#lib/trips.ts';
	import {
		arrivalOf,
		MAX_TRIP_NAME,
		tripOver,
		type LegWeather,
		upFirst,
		type PlannedTrip
	} from '#lib/planned-trips.ts';
	import { section, select, primary, secondary } from '#lib/styles.ts';

	/**
	 * Viajes → Próximos: the trips still to come, each with who goes and its legs, and each leg's
	 * weather where and when it leaves and arrives. A new trip, a leg from a kept route or a start
	 * and an end, its time moved, and all of it deleted.
	 */
	let {
		trips,
		weather,
		people,
		places,
		routes,
		problems
	}: {
		trips: PlannedTrip[];
		weather: Promise<Record<number, LegWeather>>;
		people: AgendaPerson[];
		places: SavedPlace[];
		routes: SavedRoute[];
		problems: { trip?: string; leg?: string; tripId?: number } | null;
	} = $props();

	const today = localDay();
	const coming = $derived(trips.filter((t) => !tripOver(t, today)));
	const past = $derived(trips.filter((t) => tripOver(t, today)));
	const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? null;
	const whoGoes = (t: PlannedTrip) =>
		t.people.length ? t.people.map(nameOf).filter(Boolean).join(', ') : 'Toda la familia';

	/** The last day forecast: a leg after it has no weather yet. */
	const lastForecast = (() => {
		const d = new Date(`${today}T12:00:00Z`);
		d.setUTCDate(d.getUTCDate() + FORECAST_DAYS - 1);
		return d.toISOString().slice(0, 10);
	})();
	/** From when a leg on `day` has its forecast. */
	function forecastFrom(day: string) {
		const d = new Date(`${day}T12:00:00Z`);
		d.setUTCDate(d.getUTCDate() - FORECAST_DAYS + 1);
		return dayName(d.toISOString().slice(0, 10), true);
	}

	const weatherText = (w: HourWeather) =>
		`${skyIcon(w.code)} ${w.temperature} °C${w.rain >= 30 ? `, lluvia ${w.rain} %` : ''}${w.wind >= 40 ? `, viento ${w.wind} km/h` : ''}`;

	// The trip being made or changed (its id; 0, a new one), and the one getting a new leg.
	let editing = $state<number | null>(null);
	let addingTo = $state<number | null>(null);
	let movingLeg = $state<number | null>(null);
	let deleting = $state<number | null>(null);
	let showPast = $state(false);

	/** A new leg's way: a kept route, or a start and an end. */
	let byRoute = $state(true);
	let from = $state<{ name: string; at: LngLat } | null>(null);
	let to = $state<{ name: string; at: LngLat } | null>(null);
	function openLeg(tripId: number) {
		addingTo = tripId;
		byRoute = routes.length > 0;
		from = null;
		to = null;
	}
	const placeChoice = (id: string) => {
		const p = places.find((p) => String(p.id) === id);
		return p ? { name: p.name, at: p.at } : null;
	};
</script>

{#snippet tripForm(trip: PlannedTrip | null)}
	<form
		method="post"
		action="?/saveTrip"
		use:enhance={() =>
			async ({ result, update }) => {
				await update({ reset: false });
				if (result.type === 'success') editing = null;
			}}
		class="flex flex-col gap-3"
	>
		{#if trip}<input type="hidden" name="id" value={trip.id} />{/if}
		<label class="flex flex-col gap-1 text-sm">
			Nombre
			<input
				name="name"
				required
				maxlength={MAX_TRIP_NAME}
				value={trip?.name ?? ''}
				placeholder="Puente en Asturias"
				class={select}
			/>
		</label>
		{#if people.length > 1}
			<fieldset class="text-sm">
				<legend class="mb-1"
					>Quién va <span class="text-zinc-500">(nadie marcado: toda la familia)</span></legend
				>
				<div class="flex flex-wrap gap-x-4 gap-y-1">
					{#each people as p (p.id)}
						<label class="flex items-center gap-1.5">
							<input
								type="checkbox"
								name="people"
								value={p.id}
								checked={trip?.people.includes(p.id) ?? false}
								class="rounded border-zinc-600 bg-zinc-900"
							/>
							{p.name}
						</label>
					{/each}
				</div>
			</fieldset>
		{/if}
		<label class="flex items-center gap-2 text-sm">
			<input
				type="checkbox"
				name="private"
				checked={trip?.private ?? false}
				class="rounded border-zinc-600 bg-zinc-900"
			/>
			Solo para mí <span class="text-zinc-500">(no lo ve nadie más, ni sale en la Agenda)</span>
		</label>
		<div class="flex gap-2">
			<button class={primary}>{trip ? 'Guardar' : 'Crear el viaje'}</button>
			<button type="button" class={secondary} onclick={() => (editing = null)}>Cancelar</button>
		</div>
		{#if problems?.trip}<p class="text-sm text-red-400">{problems.trip}</p>{/if}
	</form>
{/snippet}

{#snippet endPicker(which: 'from' | 'to')}
	{@const label = which === 'from' ? 'Desde' : 'Hasta'}
	{@const chosen = which === 'from' ? from : to}
	{@const set = (v: { name: string; at: LngLat } | null) =>
		which === 'from' ? (from = v) : (to = v)}
	<div class="flex flex-col gap-1 text-sm">
		<span
			>{label}{#if chosen}: <strong>{chosen.name}</strong>{/if}</span
		>
		{#if places.length}
			<select
				class={select}
				onchange={(e) => set(placeChoice(e.currentTarget.value))}
				aria-label="{label}: un sitio guardado"
			>
				<option value="">Un sitio guardado…</option>
				{#each places as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
			</select>
		{/if}
		<PointFinder
			placeholder="O búscalo, o pega coordenadas o un enlace"
			onfound={(p) => set({ name: p.address?.split(',')[0] ?? label, at: p.at })}
		/>
	</div>
{/snippet}

{#snippet legForm(trip: PlannedTrip)}
	{@const last = trip.legs.at(-1)}
	<form
		method="post"
		action="?/addLeg"
		use:enhance={() =>
			async ({ result, update }) => {
				await update({ reset: false });
				if (result.type === 'success') addingTo = null;
			}}
		class="mt-3 flex flex-col gap-3 rounded-md border border-zinc-800 p-3"
	>
		<input type="hidden" name="trip" value={trip.id} />
		<div class="flex flex-wrap gap-3">
			<label class="flex flex-col gap-1 text-sm">
				Día
				<input
					type="date"
					name="day"
					required
					min={today}
					value={last ? arrivalOf(last).day : ''}
					class={select}
				/>
			</label>
			<label class="flex flex-col gap-1 text-sm">
				Sale a las
				<input type="time" name="time" required value="09:00" class={select} />
			</label>
		</div>
		{#if routes.length}
			<div class="flex gap-4 text-sm">
				<label class="flex items-center gap-1.5"
					><input type="radio" bind:group={byRoute} value={true} /> Una ruta guardada</label
				>
				<label class="flex items-center gap-1.5"
					><input type="radio" bind:group={byRoute} value={false} /> Desde y hasta</label
				>
			</div>
		{/if}
		{#if byRoute && routes.length}
			<select name="route" required class={select}>
				{#each routes as r (r.id)}
					<option value={r.id}>{r.name} · {distanceText(r.distance)}</option>
				{/each}
			</select>
		{:else}
			{@const stops = from && to ? [from, to] : []}
			<input type="hidden" name="stops" value={JSON.stringify(stops)} />
			{@render endPicker('from')}
			{@render endPicker('to')}
		{/if}
		<div class="flex gap-2">
			<button class={primary} disabled={!byRoute && !(from && to)}>Añadir el tramo</button>
			<button type="button" class={secondary} onclick={() => (addingTo = null)}>Cancelar</button>
		</div>
		{#if problems?.leg && problems.tripId === trip.id}
			<p class="text-sm text-red-400">{problems.leg}</p>
		{/if}
	</form>
{/snippet}

{#snippet tripCard(trip: PlannedTrip)}
	<li class="rounded-md border border-zinc-800 p-4">
		{#if editing === trip.id}
			{@render tripForm(trip)}
		{:else}
			<div class="mb-2 flex flex-wrap items-start gap-2">
				<div class="mr-auto min-w-0">
					<h3 class="font-semibold">{trip.private ? '🔒 ' : ''}{trip.name}</h3>
					<p class="text-sm text-zinc-400">{whoGoes(trip)}</p>
				</div>
				<button class={secondary} onclick={() => (editing = trip.id)}>Cambiar</button>
				{#if deleting === trip.id}
					<form method="post" action="?/deleteTrip" use:enhance>
						<input type="hidden" name="id" value={trip.id} />
						<button class="{secondary} border-red-500/60 text-red-300">Sí, borrarlo</button>
					</form>
				{:else}
					<button class={secondary} onclick={() => (deleting = trip.id)}>Borrar</button>
				{/if}
			</div>
			{#if trip.legs.length}
				<ol class="flex flex-col gap-3">
					{#each trip.legs as leg (leg.id)}
						{@const arrival = arrivalOf(leg)}
						<li class="border-l-2 border-amber-500/50 pl-3">
							<p class="text-sm">
								{upFirst(dayName(leg.day))}, {leg.time}
								<span class="text-zinc-400"
									>→ llega {arrival.day === leg.day ? '' : `el ${dayName(arrival.day)} `}a las {arrival.time}</span
								>
							</p>
							<p class="font-medium">{leg.from} → {leg.to}</p>
							<p class="text-sm text-zinc-400">
								{distanceText(leg.distance)} · {durationText(leg.duration)}
							</p>
							{#if arrival.day >= today}
								{#if leg.day > lastForecast}
									<p class="text-sm text-zinc-500">El tiempo, desde el {forecastFrom(leg.day)}.</p>
								{:else}
									{#await weather}
										<p class="text-sm text-zinc-500">Mirando el tiempo…</p>
									{:then all}
										{@const w = all[leg.id]}
										{#if w?.depart || w?.arrive}
											<p class="text-sm">
												{#if w.depart}Salida {weatherText(w.depart)}{/if}{#if w.depart && w.arrive}
													·
												{/if}{#if w.arrive}Llegada {weatherText(w.arrive)}{/if}
											</p>
										{/if}
									{/await}
								{/if}
							{/if}
							{#if movingLeg === leg.id}
								<form
									method="post"
									action="?/moveLeg"
									use:enhance={() =>
										async ({ update }) => {
											await update();
											movingLeg = null;
										}}
									class="mt-2 flex flex-wrap items-end gap-2"
								>
									<input type="hidden" name="id" value={leg.id} />
									<input type="date" name="day" required value={leg.day} class={select} />
									<input type="time" name="time" required value={leg.time} class={select} />
									<button class={primary}>Guardar</button>
									<button type="button" class={secondary} onclick={() => (movingLeg = null)}
										>Cancelar</button
									>
								</form>
							{:else}
								<div class="mt-1 flex gap-3 text-sm">
									<button
										class="text-amber-400 hover:underline"
										onclick={() => (movingLeg = leg.id)}>Cambiar el día o la hora</button
									>
									<form method="post" action="?/deleteLeg" use:enhance>
										<input type="hidden" name="id" value={leg.id} />
										<button class="text-zinc-400 hover:text-white">Quitar</button>
									</form>
								</div>
							{/if}
						</li>
					{/each}
				</ol>
			{:else}
				<p class="text-sm text-zinc-400">Aún sin tramos: añade la ida, y la vuelta si la hay.</p>
			{/if}
			{#if addingTo === trip.id}
				{@render legForm(trip)}
			{:else if trip.legs.length < 20}
				<button class="mt-3 text-sm text-amber-400 hover:underline" onclick={() => openLeg(trip.id)}
					>+ Tramo</button
				>
			{/if}
		{/if}
	</li>
{/snippet}

<section class={section}>
	<div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
		<h2 class="font-semibold">Próximos viajes</h2>
		{#if editing !== 0}
			<button class="text-sm text-amber-400 hover:underline" onclick={() => (editing = 0)}
				>+ Nuevo viaje</button
			>
		{/if}
	</div>
	<p class="mb-4 text-sm text-zinc-400">
		Cada viaje, con sus tramos y la hora a la que sale cada uno. Con el tiempo de la salida y de la
		llegada (los próximos {FORECAST_DAYS} días), en la Agenda de quien va, y el próximo en la portada.
	</p>
	{#if editing === 0}
		<div class="mb-4 rounded-md border border-zinc-800 p-4">{@render tripForm(null)}</div>
	{/if}
	{#if coming.length}
		<ul class="flex flex-col gap-4">
			{#each coming as trip (trip.id)}{@render tripCard(trip)}{/each}
		</ul>
	{:else if editing !== 0}
		<p class="text-sm text-zinc-400">Ninguno todavía.</p>
	{/if}
	{#if past.length}
		<button
			class="mt-4 text-sm text-zinc-400 hover:text-white"
			onclick={() => (showPast = !showPast)}
			>{showPast ? 'Ocultar' : 'Ver'} los pasados ({past.length})</button
		>
		{#if showPast}
			<ul class="mt-3 flex flex-col gap-4 opacity-70">
				{#each past as trip (trip.id)}{@render tripCard(trip)}{/each}
			</ul>
		{/if}
	{/if}
</section>
