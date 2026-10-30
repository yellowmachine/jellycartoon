<script lang="ts">
	import { enhance } from '$app/forms';
	import Guardado from 'comun/components/Guardado.svelte';
	import { MAX_CAR_NAME } from '#lib/cars.ts';
	import { field, primary, secondary, section, select } from '#lib/styles.ts';
	import type { ActionData, PageData } from './$types';

	/**
	 * Los coches de la familia (#317): con alguno, «¿Dónde está el coche?» en Viajes y en la
	 * portada. Cada uno elige el suyo: sus viajes van en él.
	 */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	/** The one being renamed. */
	let editing = $state<number | null>(null);
	const keep =
		() =>
		async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			editing = null;
			await update();
		};
</script>

<section class={section} id="coches">
	<h2 class="mb-1 font-semibold">Coches</h2>
	<p class="mb-4 text-sm text-zinc-400">
		Para saber dónde está cada uno, en Viajes y en la portada: donde acabó su último viaje, o donde
		alguien diga «Aquí y ahora» al aparcarlo. Cada uno elige el suyo, y sus viajes van en él.
	</p>

	{#if data.cars.length}
		<ul class="mb-4 divide-y divide-zinc-800">
			{#each data.cars as c (c.id)}
				<li class="py-2">
					{#if editing === c.id}
						<form
							method="post"
							action="?seccion={tab}&/saveCar"
							use:enhance={keep}
							class="flex gap-2"
						>
							<input type="hidden" name="id" value={c.id} />
							<input
								name="name"
								value={c.name}
								required
								maxlength={MAX_CAR_NAME}
								class="{field} min-w-0 flex-1"
							/>
							<button class={primary}>Guardar</button>
							<button type="button" class={secondary} onclick={() => (editing = null)}
								>Cancelar</button
							>
						</form>
					{:else}
						<div class="flex items-center gap-3">
							<span class="min-w-0 flex-1 truncate">🚗 {c.name}</span>
							<button
								class="text-sm text-zinc-400 hover:text-white"
								onclick={() => (editing = c.id)}>Cambiar</button
							>
							<form method="post" action="?seccion={tab}&/deleteCar" use:enhance>
								<input type="hidden" name="id" value={c.id} />
								<button class="text-sm text-zinc-500 hover:text-red-400">Quitar</button>
							</form>
						</div>
					{/if}
				</li>
			{/each}
		</ul>

		<form
			method="post"
			action="?seccion={tab}&/myCar"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
			class="mb-4 flex items-center gap-2 text-sm"
		>
			<label for="mi-coche">El tuyo:</label>
			<select
				id="mi-coche"
				name="car"
				class={select}
				value={data.myCar ?? ''}
				onchange={(e) => e.currentTarget.form?.requestSubmit()}
			>
				<option value="">Ninguno</option>
				{#each data.cars as c (c.id)}
					<option value={c.id}>{c.name}</option>
				{/each}
			</select>
			{#if form && 'saved' in form && form.saved === 'myCar'}
				<Guardado class="text-amber-400">✓ Guardado</Guardado>
			{/if}
		</form>
	{/if}

	<form method="post" action="?seccion={tab}&/saveCar" use:enhance class="flex gap-2">
		<input
			name="name"
			required
			maxlength={MAX_CAR_NAME}
			placeholder={data.cars.length ? 'Otro coche' : 'El coche: «El rojo», «La furgo»…'}
			class="{field} min-w-0 flex-1"
		/>
		<button class={primary}>Añadir</button>
	</form>
	{#if form && 'carProblem' in form}
		<p class="mt-2 text-sm text-red-400">{form.carProblem}</p>
	{/if}
</section>
