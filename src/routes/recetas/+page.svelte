<script lang="ts">
	import { enhance } from '$app/forms';
	import SectionIcon from '#lib/components/SectionIcon.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** Reading the page and preparing its steps: some seconds with the AI. */
	let saving = $state(false);
</script>

<svelte:head>
	<title>Recetario · JellyCartoon</title>
</svelte:head>

<h1 class="mb-1 text-2xl font-bold">Recetario</h1>
<p class="mb-4 max-w-2xl text-sm text-zinc-400">
	Las recetas de casa, para cocinarlas paso a paso en la cocina («vamos a hacer los macarrones»). Se
	guardan desde la página de una web de cocina: pega aquí su dirección o, en el móvil, compártela
	desde el navegador con JellyCartoon.
</p>

<form
	method="post"
	action="?/import"
	class="mb-2 flex max-w-2xl gap-2"
	use:enhance={() => {
		saving = true;
		return async ({ update }) => {
			await update({ reset: false });
			saving = false;
		};
	}}
>
	<input
		type="url"
		name="url"
		value={form?.url ?? data.shared ?? ''}
		required
		autocomplete="url"
		placeholder="https://…/receta-de-macarrones"
		aria-label="Dirección de la receta"
		class="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
	/>
	<button
		class="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
		disabled={saving}>{saving ? 'Leyendo la receta…' : 'Guardar'}</button
	>
</form>
{#if form?.error}
	<p class="mb-4 text-sm text-red-400">{form.error}</p>
{:else if data.shared}
	<p class="mb-4 text-sm text-amber-300">Compartida desde el móvil: pulsa «Guardar».</p>
{/if}

<section class="mt-6">
	{#if !data.recipes.length}
		<p class="text-sm text-zinc-400">Todavía no hay ninguna.</p>
	{:else}
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
			{#each data.recipes as r (r.id)}
				<a href="/recetas/{r.id}" class="group min-w-0">
					{#if r.imageUrl}
						<img
							src={r.imageUrl}
							alt=""
							loading="lazy"
							referrerpolicy="no-referrer"
							class="mb-2 aspect-square w-full rounded-md bg-zinc-800 object-cover group-hover:opacity-80"
						/>
					{:else}
						<span
							class="mb-2 flex aspect-square w-full items-center justify-center rounded-md bg-zinc-800 text-zinc-600"
							><SectionIcon name="recetas" class="h-1/3 w-1/3" /></span
						>
					{/if}
					<span class="block truncate text-sm group-hover:text-amber-400">{r.title}</span>
					<span class="block truncate text-xs text-zinc-500">{r.sourceName}</span>
				</a>
			{/each}
		</div>
	{/if}
</section>
