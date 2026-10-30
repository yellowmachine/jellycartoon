<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import PlacesMap from '#lib/components/PlacesMap.svelte';
	import { agoText, isMoving, MAX_CAR_NOTE, walkTo, type CarView } from '#lib/cars.ts';
	import { field, primary, section } from '#lib/styles.ts';
	import type { LngLat } from 'comun/road.ts';

	/**
	 * «¿Dónde está el coche?» (#317), in Viajes: each car of the family, where it is and since when,
	 * «Llévame» on foot, and «Aquí y ahora» to say it is where this phone is, with a note.
	 */
	let {
		cars,
		mine,
		map,
		problem
	}: {
		cars: CarView[];
		/** Their car, first. */
		mine: number | null;
		/** The app's own map is there. */
		map: boolean;
		problem: string | null;
	} = $props();

	const sorted = $derived([...cars].sort((a, b) => Number(b.id === mine) - Number(a.id === mine)));
	const marks = $derived(
		sorted.flatMap((c) => (c.place ? [{ at: c.place.at, label: c.name }] : []))
	);
	let focus = $state<LngLat | null>(null);

	let now = $state(new Date());
	onMount(() => {
		const tick = setInterval(() => (now = new Date()), 30_000);
		return () => clearInterval(tick);
	});

	/** The car whose «Aquí y ahora» is asking the GPS, and why it could not. */
	let locating = $state<number | null>(null);
	let gpsProblem = $state<{ car: number; text: string } | null>(null);

	function here(e: MouseEvent, carId: number) {
		const form = (e.currentTarget as HTMLButtonElement).form!;
		if (!('geolocation' in navigator))
			return void (gpsProblem = { car: carId, text: 'Este navegador no da la posición.' });
		locating = carId;
		gpsProblem = null;
		navigator.geolocation.getCurrentPosition(
			({ coords }) => {
				locating = null;
				form.lon.value = String(coords.longitude);
				form.lat.value = String(coords.latitude);
				form.accuracy.value = String(Math.round(coords.accuracy));
				form.requestSubmit();
			},
			(err) => {
				locating = null;
				gpsProblem = {
					car: carId,
					text:
						err.code === err.PERMISSION_DENIED
							? 'Sin permiso para la posición: dalo en el navegador.'
							: 'No llega la posición del GPS: prueba otra vez, mejor al aire libre.'
				};
			},
			{ enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 }
		);
	}
</script>

<section class="{section} mt-6" id="coches">
	<h2 class="mb-3 font-semibold">¿Dónde está el coche?</h2>
	<ul class="flex flex-col gap-4">
		{#each sorted as c (c.id)}
			<li>
				<p class="font-medium">
					🚗 {c.name}{#if c.id === mine}<span class="font-normal text-zinc-400">
							· el tuyo</span
						>{/if}
				</p>
				{#if c.place}
					<p class="text-sm text-zinc-300">
						{#if isMoving(c.place, now)}
							En marcha{c.place.by ? ` con ${c.place.by}` : ''}
						{:else}
							{c.place.trip ? 'Acabó su viaje' : 'Aparcado'}
							{agoText(new Date(c.place.when), now)}{c.place.by ? ` · ${c.place.by}` : ''}
						{/if}
					</p>
					{#if c.place.note}
						<p class="text-sm text-amber-300">{c.place.note}</p>
					{/if}
					<p class="mt-1 flex gap-4 text-sm">
						<a
							href={walkTo(c.place.at)}
							target="_blank"
							rel="noreferrer"
							class="text-amber-400 hover:underline">Llévame</a
						>
						{#if map}
							<button class="text-amber-400 hover:underline" onclick={() => (focus = c.place!.at)}
								>En el mapa</button
							>
						{/if}
					</p>
				{:else}
					<p class="text-sm text-zinc-400">Aún no se sabe dónde está.</p>
				{/if}

				<form method="post" action="?/park" use:enhance class="mt-2 flex flex-wrap gap-2">
					<input type="hidden" name="id" value={c.id} />
					<input type="hidden" name="lon" />
					<input type="hidden" name="lat" />
					<input type="hidden" name="accuracy" />
					<input
						name="note"
						maxlength={MAX_CAR_NOTE}
						placeholder="Nota, si quieres: planta -2, plaza 47"
						class="{field} min-w-0 flex-1 text-sm"
					/>
					<button
						type="button"
						class={primary}
						disabled={locating !== null}
						onclick={(e) => here(e, c.id)}
						>{locating === c.id ? 'Buscando dónde estás…' : 'Aquí y ahora'}</button
					>
				</form>
				{#if gpsProblem?.car === c.id}
					<p class="mt-1 text-sm text-red-400">{gpsProblem.text}</p>
				{/if}
			</li>
		{/each}
	</ul>
	{#if problem}
		<p class="mt-2 text-sm text-red-400">{problem}</p>
	{/if}
	{#if map && marks.length}
		<div class="mt-4">
			<PlacesMap {marks} focus={focus ?? marks[0]!.at} />
		</div>
	{/if}
</section>
