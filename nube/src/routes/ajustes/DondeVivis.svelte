<script lang="ts">
	import { enhance } from '$app/forms';
	import Guardado from 'comun/components/Guardado.svelte';
	import { section, select, primary, secondary } from '#lib/styles.ts';
	import type { Place } from 'comun/weather.ts';
	import type { PageData, ActionData } from './$types';

	/**
	 * Dónde vivís, si se quiere: para el tiempo de la portada y de la voz, con Open-Meteo. Como el
	 * «Dónde está la casa» de jellycartoon; buscado con openrouteservice si hay su clave (places.ts).
	 */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	/** What the search found, to choose one. */
	const found = $derived(
		form && 'familyPlaces' in form ? (form.familyPlaces as Place[] | undefined) : undefined
	);
</script>

{#if data.place}
	<section class={section} id="donde-vivis">
		<h2 class="mb-1 font-semibold">Dónde vivís</h2>
		<p class="mb-4 text-sm text-zinc-400">
			Si queréis, para ver el tiempo en la portada y que la voz lo diga sin preguntar el sitio.
			Basta el pueblo o la ciudad; con la clave de openrouteservice (Viajes), también con su
			provincia: «Vélez-Rubio, Almería». El tiempo se pregunta a
			<a
				href="https://open-meteo.com"
				target="_blank"
				rel="noreferrer"
				class="text-amber-400 hover:underline">Open-Meteo</a
			>, gratis y sin clave: solo sale ese punto, al pedir el tiempo.
		</p>

		{#if data.place.name}
			<p class="mb-3 text-sm">{data.place.name}</p>
		{/if}

		<form method="post" action="?seccion={tab}&/findPlace" use:enhance class="flex gap-2">
			<input name="name" required placeholder="Toledo" class="{select} min-w-0 flex-1" />
			<button class={primary}>{data.place.name ? 'Cambiar' : 'Buscar'}</button>
		</form>

		{#if found}
			{#if found.length}
				<p class="mt-3 mb-1 text-sm text-zinc-400">¿Cuál es?</p>
				<ul class="flex flex-col gap-1">
					{#each found as p, i (i)}
						<li>
							<form method="post" action="?seccion={tab}&/savePlace" use:enhance>
								<input type="hidden" name="place" value={JSON.stringify(p)} />
								<button class="{secondary} w-full text-left">
									{p.name}<span class="text-zinc-400"
										>{p.region ? `, ${p.region}` : ''}{p.country ? `, ${p.country}` : ''}</span
									>
								</button>
							</form>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="mt-2 text-sm text-red-400">No se encuentra ningún sitio con ese nombre.</p>
			{/if}
		{/if}
		{#if form && 'placeProblem' in form}
			<p class="mt-2 text-sm text-red-400">{form.placeProblem}</p>
		{/if}

		<div class="mt-3 flex items-center gap-3">
			{#if data.place.name}
				<form method="post" action="?seccion={tab}&/clearPlace" use:enhance>
					<button class={secondary}>Quitar</button>
				</form>
			{/if}
			{#if form && 'saved' in form && form.saved === 'place'}
				<Guardado class="text-sm text-amber-400">✓ Guardado</Guardado>
			{/if}
		</div>
	</section>
{/if}
