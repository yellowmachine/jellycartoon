<script lang="ts">
	import ConfirmForm from 'comun/components/ConfirmForm.svelte';
	import Guardado from 'comun/components/Guardado.svelte';
	import { enhance } from '$app/forms';
	import { field, primary, section } from '#lib/styles.ts';
	import type { ActionData, PageData } from './$types';

	/** What they weigh, by the day they noted it, for the kcal of their walks (Paseos). */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	const last = $derived(data.weights[0]);
	const said = (kg: number) =>
		`${kg.toLocaleString('es-ES', { maximumFractionDigits: 1, useGrouping: false })} kg`;
	const dayText = (day: string) =>
		new Date(`${day}T12:00:00Z`).toLocaleDateString('es-ES', {
			day: 'numeric',
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		});
</script>

<section class={section} id="peso">
	<h2 class="mb-1 font-semibold">Tu peso</h2>
	<p class="mb-3 text-sm text-zinc-400">
		Opcional y solo para ti: con él, <a href="/paseos" class="text-amber-400 hover:underline"
			>Paseos</a
		>
		dice las kcal que gastas andando. Se guarda con su día, así que al cambiarlo los paseos de antes se
		quedan con el de entonces.
	</p>
	{#if last}
		<p class="mb-3 text-sm">
			{said(last.kg)} <span class="text-zinc-400">desde el {dayText(last.day)}</span>
		</p>
	{/if}
	<form
		method="post"
		action="?seccion={tab}&/saveWeight"
		use:enhance
		class="flex items-center gap-2"
	>
		<input
			name="kg"
			required
			inputmode="decimal"
			maxlength="8"
			placeholder="72,5"
			aria-label="Tu peso hoy, en kg"
			autocomplete="off"
			class="{field} w-28!"
		/>
		<span class="text-sm text-zinc-400">kg</span>
		<button class={primary}>Guardar</button>
		{#if form && 'saved' in form && form.saved === 'weight'}
			<Guardado class="text-amber-400">✓ Guardado</Guardado>
		{/if}
	</form>
	{#if form && 'weightProblem' in form && form.weightProblem}
		<p class="mt-2 text-sm text-red-400" role="alert">{form.weightProblem}</p>
	{/if}
	{#if data.weights.length}
		<details class="mt-3 text-sm">
			<summary class="cursor-pointer text-zinc-400">
				{data.weights.length === 1 ? 'El apuntado' : `Los ${data.weights.length} apuntados`}
			</summary>
			<ul class="mt-2 divide-y divide-zinc-800">
				{#each data.weights as w (w.day)}
					<li class="flex items-center gap-3 py-2">
						<span class="flex-1">{said(w.kg)} · {dayText(w.day)}</span>
						<ConfirmForm
							action="?seccion={tab}&/deleteWeight"
							fields={{ day: w.day }}
							label="Quitar"
							question="¿Quitarlo?"
							yes="Sí, quitar"
							class="text-zinc-500 hover:text-red-400"
						/>
					</li>
				{/each}
			</ul>
		</details>
	{/if}
</section>
