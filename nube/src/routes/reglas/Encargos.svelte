<script lang="ts">
	import Guardado from 'comun/components/Guardado.svelte';
	import Espera from '#lib/components/Espera.svelte';
	import { addDays, localDay } from 'comun/agenda.ts';
	import { enhance } from '$app/forms';
	import { field, section, select, secondary } from '#lib/styles.ts';
	import type { PageData, ActionData } from './$types';

	/**
	 * Los encargos (#557, fase 3): lo que se ha dejado programado para un día y una hora, una sola
	 * vez («mañana a las 9, si hace frío en casa, pon el termo una hora»), por voz, en Preguntar o
	 * aquí. Los que vienen, por días (hoy, mañana, más adelante), cada uno con «Cambiar la hora»
	 * (sin la IA: su frase no lleva la hora) y, tocando el texto, reescribirlo o cancelarlo; debajo,
	 * los últimos que pasaron, con lo que hizo o por qué no. Los pasados se van solos a la semana.
	 */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	type Errand = PageData['errands']['coming'][number];

	let moving = $state<number | null>(null);
	let editing = $state<number | null>(null);
	let understanding = $state(false);

	const today = localDay();
	const tomorrow = addDays(today, 1);
	const groups = $derived(
		[
			{ title: 'Hoy', items: data.errands.coming.filter((e) => e.day <= today) },
			{ title: 'Mañana', items: data.errands.coming.filter((e) => e.day === tomorrow) },
			{ title: 'Más adelante', items: data.errands.coming.filter((e) => e.day > tomorrow) }
		].filter((g) => g.items.length)
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
	const icon = (e: Errand) => (e.plug ? '🔌' : '🔔');
</script>

<section class={section} id="encargos">
	{#if understanding}
		<Espera>Entendiendo el encargo…</Espera>
	{/if}
	<h2 class="mb-1 font-semibold">Encargos</h2>
	<p class="mb-3 text-sm text-zinc-400">
		Lo que dejas programado para un día y una hora, una sola vez: «mañana a las 9, si en casa hay
		menos de 15 grados, pon el termo una hora». Díselo a la voz, pídelo en
		<a href="/preguntar" class="text-amber-400 hover:underline">Preguntar</a> o escríbelo aquí. Lo
		que hizo, o por qué no, queda en tu
		<a href="/buzon" class="text-amber-400 hover:underline">Buzón</a>.
	</p>

	{#if !groups.length}
		<p class="mb-4 text-sm text-zinc-500">No hay nada programado.</p>
	{/if}
	{#each groups as g (g.title)}
		<h3 class="mt-4 mb-2 text-sm font-semibold text-zinc-300">{g.title}</h3>
		<ul class="mb-2 flex flex-col gap-2">
			{#each g.items as e (e.id)}
				<li class="rounded-md bg-zinc-900 p-3">
					{#if editing === e.id}
						<form
							method="post"
							action="?ver={tab}&/saveRule"
							use:enhance={() => {
								understanding = true;
								return async ({ result, update }) => {
									await update({ reset: false });
									understanding = false;
									if (result.type === 'success') editing = null;
								};
							}}
							class="flex flex-col gap-2"
						>
							<input type="hidden" name="id" value={e.id} />
							<textarea name="text" rows="2" maxlength="500" class={field}>{e.said}</textarea>
							<p class="text-xs text-zinc-500">La IA lo vuelve a entender al guardar.</p>
							<div class="flex flex-wrap items-center gap-2">
								<button class={secondary}>Guardar</button>
								<button type="button" class={secondary} onclick={() => (editing = null)}
									>No cambiar</button
								>
								<button
									formaction="?ver={tab}&/deleteRule"
									class="ml-auto rounded-md px-3 py-1 text-sm text-red-400 hover:bg-red-950/50"
									>Cancelar el encargo</button
								>
							</div>
						</form>
					{:else}
						<button
							type="button"
							class="text-left text-zinc-100"
							onclick={() => (editing = e.id)}
							title="Cambiar o cancelar">{icon(e)} {e.read}</button
						>
						<p class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
							<span
								class="rounded-full px-2 py-0.5 {e.mine
									? 'bg-sky-950 text-sky-300'
									: 'bg-amber-950 text-amber-300'}">{e.mine ? 'Solo tuyo' : 'De la casa'}</span
							>
							<button
								type="button"
								class="text-zinc-400 hover:text-amber-400"
								onclick={() => (moving = moving === e.id ? null : e.id)}>Cambiar la hora</button
							>
							<button
								type="button"
								class="text-zinc-400 hover:text-red-400"
								onclick={() => (editing = e.id)}>Cancelar…</button
							>
						</p>
						{#if moving === e.id}
							<form
								method="post"
								action="?ver={tab}&/moveErrand"
								use:enhance={() =>
									async ({ result, update }) => {
										await update({ reset: false });
										if (result.type === 'success') moving = null;
									}}
								class="mt-2 flex flex-wrap items-center gap-2 text-sm"
							>
								<input type="hidden" name="id" value={e.id} />
								<input
									type="date"
									name="day"
									value={e.day}
									min={today}
									class="{select} py-1"
									aria-label="Día"
								/>
								<input
									type="time"
									name="time"
									value={e.time}
									class="{select} py-1"
									aria-label="Hora"
								/>
								<button class={secondary}>Guardar</button>
							</form>
						{/if}
					{/if}
					{#if problemFor(e.id)}
						<p class="mt-1 text-sm text-red-400">{problemFor(e.id)}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/each}

	<form
		method="post"
		action="?ver={tab}&/saveRule"
		use:enhance={() => {
			understanding = true;
			return async ({ result, update }) => {
				await update({ reset: result.type === 'success' });
				understanding = false;
			};
		}}
		class="mt-4 flex flex-col gap-2 text-sm"
	>
		<textarea
			name="text"
			rows="2"
			maxlength="500"
			required
			placeholder="Mañana a las 9, si en casa hay menos de 15 grados, pon el termo una hora"
			class={field}></textarea>
		<div class="flex flex-wrap items-center gap-2">
			<select name="whose" class={select}>
				<option value="me">Solo mío</option>
				<option value="house">De la casa</option>
			</select>
			<button class={secondary}>Programar</button>
			{#if form && 'saved' in form && form.saved === 'rule' && 'ruleId' in form}
				<Guardado class="text-amber-400">✓ Guardado</Guardado>
			{/if}
		</div>
		{#if problemFor(null)}
			<p class="text-sm text-red-400">{problemFor(null)}</p>
		{/if}
	</form>

	{#if data.errands.past.length}
		<h3 class="mt-6 mb-2 text-sm font-semibold text-zinc-300">Ya pasaron</h3>
		<ul class="flex flex-col gap-2 text-sm">
			{#each data.errands.past as e (e.id)}
				<li class="rounded-md bg-zinc-900/60 p-3 text-zinc-400">
					<p>{icon(e)} {e.read}</p>
					<p class="mt-1 text-xs text-zinc-500">
						{#if e.lastFiredAt}
							✓ Hecho el {when(e.lastFiredAt)}{e.lastWhy ? `: ${e.lastWhy}` : ''}.
						{:else}
							✗ No se hizo{e.lastWhy ? `: ${e.lastWhy}` : ''}.
						{/if}
					</p>
					<form method="post" action="?ver={tab}&/deleteRule" use:enhance={keep} class="mt-1">
						<input type="hidden" name="id" value={e.id} />
						<button class="text-xs text-zinc-500 hover:text-red-400">Quitar</button>
					</form>
				</li>
			{/each}
		</ul>
		<p class="mt-2 text-xs text-zinc-500">Se quitan solos a la semana.</p>
	{/if}
</section>
