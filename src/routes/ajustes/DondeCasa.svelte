<script lang="ts">
	import { enhance } from '$app/forms';
	import { section, primary, secondary } from './styles.ts';
	import type { PageData, ActionData } from './$types';

	/** Dónde está la casa: para el tiempo de la voz (#223), con Open-Meteo. */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	const input = 'rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm';
</script>

{#if data.home}
	<section class={section} id="donde-casa">
		<h2 class="mb-1 font-semibold">Dónde está la casa</h2>
		<p class="mb-4 text-sm text-zinc-400">
			Para que la voz diga el tiempo («¿qué tiempo hará mañana?»). Basta el pueblo o la ciudad. Se
			pregunta a
			<a
				href="https://open-meteo.com"
				target="_blank"
				rel="noreferrer"
				class="text-amber-400 hover:underline">Open-Meteo</a
			>, gratis y sin clave: solo sale de casa ese punto, al preguntar el tiempo.
		</p>

		{#if data.home.place}
			<p class="mb-3 text-sm">{data.home.name}</p>
		{/if}

		<form method="post" action="?seccion={tab}&/findHousePlace" use:enhance class="flex gap-2">
			<input name="name" required placeholder="Toledo" class="{input} min-w-0 flex-1" />
			<button class={primary}>{data.home.place ? 'Cambiar' : 'Buscar'}</button>
		</form>

		{#if form && 'placeOptions' in form && form.placeOptions}
			{#if form.placeOptions.length}
				<p class="mt-3 mb-1 text-sm text-zinc-400">¿Cuál es?</p>
				<ul class="flex flex-col gap-1">
					{#each form.placeOptions as p, i (i)}
						<li>
							<form method="post" action="?seccion={tab}&/saveHousePlace" use:enhance>
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

		{#if data.home.place}
			<form method="post" action="?seccion={tab}&/clearHousePlace" use:enhance class="mt-3">
				<button class={secondary}>Quitar</button>
			</form>
		{/if}
	</section>
{/if}
