<script lang="ts">
	import { enhance } from '$app/forms';
	import Backdrop from 'comun/components/Backdrop.svelte';
	import { describeTimer } from '#lib/recipe.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const r = $derived(data.recipe);
	let confirmDelete = $state(false);
</script>

<svelte:head>
	<title>{r.title} · Recetario · Nube</title>
</svelte:head>

<a href="/recetas" class="text-sm text-zinc-400 hover:text-white">← Recetario</a>

{#if r.imageUrl}<Backdrop src={r.imageUrl} />{/if}

<header class="mt-2 mb-6">
	<div class="min-w-0">
		<h1 class="text-2xl font-bold [text-shadow:0_1px_10px_rgb(0_0_0/0.9)]">{r.title}</h1>
		<p class="text-zinc-400 [text-shadow:0_1px_10px_rgb(0_0_0/0.9)]">
			{#if r.servings}Para {r.servings} ·
			{/if}De
			<a href={r.sourceUrl} target="_blank" rel="noreferrer" class="hover:underline"
				>{r.sourceName}</a
			>
		</p>
		<div class="mt-4 flex flex-wrap items-center gap-2">
			{#if r.imageUrl}
				<form method="post" action="?/backdrop" use:enhance>
					<button
						class={[
							'rounded-md px-3 py-1.5 text-sm hover:bg-zinc-800',
							data.isBackdrop ? 'text-amber-400' : 'text-zinc-400 hover:text-white'
						]}
						aria-pressed={data.isBackdrop}
						title="Su imagen, de fondo de la página del recetario"
						>{data.isBackdrop ? 'Fondo del recetario ✓' : 'Usar de fondo del recetario'}</button
					>
				</form>
			{/if}
			{#if confirmDelete}
				<form method="post" action="?/delete" use:enhance class="flex items-center gap-2">
					<span class="text-sm text-zinc-400">¿Quitarla del recetario?</span>
					<button class="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500"
						>Quitar</button
					>
					<button
						type="button"
						class="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800"
						onclick={() => (confirmDelete = false)}>No</button
					>
				</form>
			{:else}
				<button
					class="rounded-md px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-800 hover:text-white"
					onclick={() => (confirmDelete = true)}>Quitar</button
				>
			{/if}
		</div>
	</div>
</header>

<div class="grid gap-8 md:grid-cols-3">
	<section>
		<h2 class="mb-2 font-semibold">Ingredientes</h2>
		<ul class="list-disc space-y-1 pl-5 text-zinc-300">
			{#each r.ingredients as ingredient, i (i)}
				<li>{ingredient}</li>
			{:else}
				<li class="list-none text-zinc-500">La web no los dice aparte.</li>
			{/each}
		</ul>
	</section>
	<section class="md:col-span-2">
		<h2 class="mb-2 font-semibold">Pasos</h2>
		<ol class="space-y-3">
			{#each r.steps as step, i (i)}
				<li class="flex gap-3">
					<span class="w-6 shrink-0 text-right text-zinc-500">{i + 1}.</span>
					<span>
						{step.text}
						{#if step.timer}
							<span class="mt-0.5 block text-sm text-amber-400">⏱ {describeTimer(step.timer)}</span>
						{/if}
					</span>
				</li>
			{/each}
		</ol>
	</section>
</div>
