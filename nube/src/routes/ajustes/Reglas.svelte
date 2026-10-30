<script lang="ts">
	import Guardado from 'comun/components/Guardado.svelte';
	import { enhance } from '$app/forms';
	import { field, section, select, secondary } from '#lib/styles.ts';
	import type { PageData, ActionData } from './$types';

	/**
	 * Las reglas (#331): se dicen con palabras («cuando vengan mis padres, si estoy de viaje,
	 * recuérdame lo de las plantas»), aquí o a la voz; la IA las entiende una vez y luego se
	 * comprueban solas. Cada una como la entendió, la última vez que avisó y por qué; y Pausar,
	 * Probar, Cambiar (se reescribe y se vuelve a entender) y Borrar. Las tuyas solo las ves tú.
	 */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	let editing = $state<number | null>(null);
	/** «Probar»'s answer, under its rule. */
	const tried = $derived(
		form && 'ruleTried' in form ? (form.ruleTried as { id: number; said: string }) : null
	);
	const when = (d: Date) =>
		d.toLocaleString('es-ES', {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	const problemFor = (id: number | null) =>
		form && 'ruleProblem' in form && (form.ruleId ?? null) === id ? form.ruleProblem : null;
	const keep =
		() =>
		async ({ update }: { update: (o?: { reset: boolean }) => Promise<void> }) =>
			update({ reset: false });
</script>

<section class={section} id="reglas">
	<h2 class="mb-1 font-semibold">Reglas</h2>
	<p class="mb-3 text-sm text-zinc-400">
		Dile cuándo avisar y de qué, con tus palabras: «cuando vengan mis padres, si estoy de viaje,
		recuérdame que les diga lo de las plantas», «si alguien pone leche en la lista, avísame». Mira
		la Agenda, la nevera, lo que recuerda, tus viajes y la hora; avisa en tu
		<a href="/buzon" class="text-amber-400 hover:underline">Buzón</a> y en el móvil. También por voz:
		«Alexa, crea una regla…».
	</p>

	{#if data.rules.length}
		<ul class="mb-4 flex flex-col divide-y divide-zinc-800 text-sm">
			{#each data.rules as r (r.id)}
				<li class="py-2">
					{#if editing === r.id}
						<form
							method="post"
							action="?seccion={tab}&/saveRule"
							use:enhance={() =>
								async ({ result, update }) => {
									await update({ reset: false });
									if (result.type === 'success') editing = null;
								}}
							class="flex flex-col gap-2"
						>
							<input type="hidden" name="id" value={r.id} />
							<textarea name="text" rows="2" maxlength="500" class={field}>{r.said}</textarea>
							<div class="flex gap-2">
								<button class={secondary}>Guardar</button>
								<button type="button" class={secondary} onclick={() => (editing = null)}
									>Cancelar</button
								>
							</div>
						</form>
					{:else}
						<p class={r.paused ? 'text-zinc-500' : 'text-zinc-200'}>
							{#if r.paused}<span class="text-xs uppercase">En pausa · </span>{/if}
							{r.understood}
						</p>
						<p class="text-xs text-zinc-500">
							{r.mine ? 'Solo tuya' : 'De toda la casa'}{r.aloud
								? ' · También en voz alta en casa'
								: ''} · Dicho: «{r.said}»
						</p>
						{#if r.lastFiredAt}
							<p class="text-xs text-zinc-500">
								Avisó el {when(r.lastFiredAt)}{r.lastWhy ? `, porque ${r.lastWhy}` : ''}.
							</p>
						{/if}
						{#if tried?.id === r.id}
							<p class="text-xs text-amber-400">{tried.said}</p>
						{/if}
						<div class="mt-1 flex flex-wrap gap-2">
							<form method="post" action="?seccion={tab}&/pauseRule" use:enhance={keep}>
								<input type="hidden" name="id" value={r.id} />
								<input type="hidden" name="paused" value={String(!r.paused)} />
								<button class={secondary}>{r.paused ? 'Seguir' : 'Pausar'}</button>
							</form>
							<form method="post" action="?seccion={tab}&/tryRule" use:enhance={keep}>
								<input type="hidden" name="id" value={r.id} />
								<button class={secondary}>Probar</button>
							</form>
							<button class={secondary} onclick={() => (editing = r.id)}>Cambiar</button>
							<form method="post" action="?seccion={tab}&/deleteRule" use:enhance={keep}>
								<input type="hidden" name="id" value={r.id} />
								<button class={secondary} aria-label="Borrar «{r.understood}»">Borrar</button>
							</form>
						</div>
					{/if}
					{#if problemFor(r.id)}
						<p class="text-sm text-red-400">{problemFor(r.id)}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<form
		method="post"
		action="?seccion={tab}&/saveRule"
		use:enhance={() =>
			async ({ result, update }) =>
				update({ reset: result.type === 'success' })}
		class="flex flex-col gap-2 text-sm"
	>
		<textarea
			name="text"
			rows="2"
			maxlength="500"
			required
			placeholder="Cuando vengan mis padres, si estoy de viaje, recuérdame que les diga lo de las plantas"
			class={field}></textarea>
		<div class="flex flex-wrap items-center gap-2">
			<select name="whose" class={select}>
				<option value="me">Solo mía</option>
				<option value="house">De la casa</option>
			</select>
			<button class={secondary}>Crear la regla</button>
			{#if form && 'saved' in form && form.saved === 'rule' && 'ruleId' in form}
				<Guardado class="text-amber-400">✓ Entendida</Guardado>
			{/if}
		</div>
		{#if problemFor(null)}
			<p class="text-sm text-red-400">{problemFor(null)}</p>
		{/if}
	</form>
</section>
