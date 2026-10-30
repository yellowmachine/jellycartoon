<script lang="ts">
	import Guardado from 'comun/components/Guardado.svelte';
	import { enhance } from '$app/forms';
	import { field, section, select, secondary } from '#lib/styles.ts';
	import type { PageData, ActionData } from './$types';

	/**
	 * Lo que se le ha pedido a la voz que recuerde («recuerda que la llave está en la maceta»): lo
	 * tuyo, que solo ves tú (ni quien administra la familia), y lo de toda la casa. Se añade aquí o
	 * por voz, y se quita con ×. Algo puede valer solo unos días («hasta el viernes, el coche está en
	 * el taller», #331): luego se olvida solo.
	 */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	const mine = $derived(data.memories.filter((m) => m.userId));
	const house = $derived(data.memories.filter((m) => !m.userId));
	const shortDay = (day: string) =>
		new Date(`${day}T12:00`).toLocaleDateString('es-ES', {
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		});
</script>

{#snippet list(memories: typeof data.memories, empty: string)}
	{#if memories.length}
		<ul class="flex flex-col gap-1">
			{#each memories as m (m.id)}
				<li class="flex items-start gap-2">
					<p class="min-w-0 flex-1 text-zinc-200">
						{m.text}
						{#if m.fromDay || m.untilDay}
							<span class="block text-xs text-zinc-500"
								>{[
									m.fromDay ? `desde el ${shortDay(m.fromDay)}` : null,
									m.untilDay ? `hasta el ${shortDay(m.untilDay)}` : null
								]
									.filter(Boolean)
									.join(', ')}</span
							>
						{/if}
					</p>
					<form method="post" action="?seccion={tab}&/forgetMemory" use:enhance>
						<input type="hidden" name="id" value={m.id} />
						<button
							class="rounded px-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
							aria-label="Olvidar «{m.text}»">×</button
						>
					</form>
				</li>
			{/each}
		</ul>
	{:else}
		<span class="text-xs text-zinc-500">{empty}</span>
	{/if}
{/snippet}

<section class={section} id="voz-recuerda">
	<h2 class="mb-1 font-semibold">Lo que la voz recuerda</h2>
	<p class="mb-3 text-sm text-zinc-400">
		Dile «recuerda que la llave de repuesto está en la maceta» y luego pregúntale «¿dónde está la
		llave?». Lo tuyo solo lo ves y lo oyes tú; lo de la casa, toda la familia (y los satélites).
		«¿Qué te he pedido que recuerdes?» te lo dice. Con «hasta el viernes…», lo olvida ese día.
	</p>
	<div class="flex flex-col gap-4 text-sm">
		<div>
			<h3 class="mb-1 text-xs tracking-wide text-zinc-500 uppercase">Solo tuyo</h3>
			{@render list(mine, 'Nada todavía.')}
		</div>
		<div>
			<h3 class="mb-1 text-xs tracking-wide text-zinc-500 uppercase">De toda la casa</h3>
			{@render list(house, 'Nada todavía.')}
		</div>
		<form
			method="post"
			action="?seccion={tab}&/addMemory"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: true })}
			class="flex flex-wrap items-center gap-2"
		>
			<input
				name="text"
				required
				maxlength="300"
				placeholder="La llave de repuesto está en la maceta"
				class="{field} min-w-0 flex-1"
			/>
			<label class="flex items-center gap-1 text-xs text-zinc-500">
				Hasta
				<input type="date" name="until" class="{field} w-auto" aria-label="Hasta (opcional)" />
			</label>
			<select name="whose" class={select}>
				<option value="me">Solo mío</option>
				<option value="house">De la casa</option>
			</select>
			<button class={secondary}>Recordar</button>
			{#if form && 'saved' in form && form.saved === 'memory'}
				<Guardado class="text-amber-400">✓</Guardado>
			{/if}
		</form>
		{#if form && 'memoryProblem' in form}
			<p class="text-sm text-red-400">{form.memoryProblem}</p>
		{/if}
	</div>
</section>
