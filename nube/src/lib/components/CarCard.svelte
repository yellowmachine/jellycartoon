<script lang="ts">
	import { enhance } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import { agoText, isMoving, walkTo, whereAmI, type CarPlace, type CarView } from '#lib/cars.ts';
	import { section } from '#lib/styles.ts';

	/**
	 * Their car on the home page (#317): its street and since when, «Llévame» by them, and «No está
	 * ahí» to say it is where this phone is, asked first: it replaces the place, with no way back.
	 */
	let { car, place, now }: { car: CarView; place: CarPlace; now: Date } = $props();

	let asking = $state(false);
	let locating = $state(false);
	let problem = $state<string | null>(null);

	const moving = $derived(isMoving(place, now));

	async function here(e: MouseEvent) {
		const form = (e.currentTarget as HTMLButtonElement).form!;
		locating = true;
		problem = null;
		try {
			const { lon, lat, accuracy } = await whereAmI();
			form.lon.value = String(lon);
			form.lat.value = String(lat);
			form.accuracy.value = String(accuracy);
			form.requestSubmit();
		} catch (err) {
			problem = (err as Error).message;
		} finally {
			locating = false;
		}
	}
</script>

<section class="{section} flex items-start justify-between gap-3">
	<div class="min-w-0">
		<a href="/viajes#coches" class="block">
			<h2 class="font-semibold">🚗 {car.name}</h2>
			{#if place.street && !moving}
				<p class="truncate text-sm">{place.street}</p>
			{/if}
			<p class="text-sm text-zinc-400">
				{#if moving}
					En marcha{place.by ? ` con ${place.by}` : ''}
				{:else}
					Aparcado {agoText(new Date(place.when), now)}{place.by ? ` · ${place.by}` : ''}
				{/if}
			</p>
			{#if place.note}
				<p class="truncate text-sm text-amber-300">{place.note}</p>
			{/if}
		</a>
		<a
			href={walkTo(place.at)}
			target="_blank"
			rel="noreferrer"
			class="mt-2 inline-block rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900"
			>Llévame</a
		>
	</div>

	{#if !moving}
		<!-- Kit 3: after another route's action, refreshAll, as update() would go to that route. -->
		<form
			method="post"
			action="/viajes?/park"
			class="flex max-w-44 shrink-0 flex-col items-end gap-1.5 text-right"
			use:enhance={() =>
				async ({ result }) => {
					if (result.type === 'success') {
						asking = false;
						await refreshAll();
					} else problem = 'No se pudo guardar: prueba otra vez.';
				}}
		>
			<input type="hidden" name="id" value={car.id} />
			<input type="hidden" name="lon" />
			<input type="hidden" name="lat" />
			<input type="hidden" name="accuracy" />
			{#if asking}
				<p class="text-sm">¿Está donde estás tú ahora?</p>
				<div class="flex gap-2">
					<button
						type="button"
						class="rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900"
						disabled={locating}
						onclick={() => ((asking = false), (problem = null))}>No</button
					>
					<button
						type="button"
						class="rounded-md bg-amber-500 px-3 py-1 text-sm font-medium text-black hover:bg-amber-400 disabled:opacity-50"
						disabled={locating}
						onclick={here}>{locating ? 'Buscando…' : 'Sí, márcalo'}</button
					>
				</div>
			{:else}
				<button
					type="button"
					class="rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900"
					onclick={() => (asking = true)}>No está ahí</button
				>
			{/if}
			{#if problem}
				<p class="text-sm text-red-400">{problem}</p>
			{/if}
		</form>
	{/if}
</section>
