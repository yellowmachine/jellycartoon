<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { kitchenMode } from '#lib/kitchen-mode.svelte.ts';
	import { describeTimer } from '#lib/recipe.ts';
	import { recipe as cooking } from '#lib/recipe.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const r = $derived(data.recipe);
	let confirmDelete = $state(false);

	/** On this device, as the voice's recipes: its steps big in /voz, and the screen on. */
	async function cook() {
		cooking.start({
			title: r.title,
			servings: r.servings,
			ingredients: r.ingredients,
			steps: r.steps
		});
		await kitchenMode.set(true);
		await goto('/voz');
	}
</script>

<svelte:head>
	<title>{r.title} · Recetario · JellyCartoon</title>
</svelte:head>

<a href="/recetas" class="text-sm text-zinc-400 hover:text-white">← Recetario</a>

<header class="mt-2 mb-6 flex flex-col gap-4 sm:flex-row">
	{#if r.imageUrl}
		<div class="relative h-48 w-48 shrink-0">
			<img
				src={r.imageUrl}
				alt=""
				referrerpolicy="no-referrer"
				class="h-full w-full rounded-md bg-zinc-800 object-cover"
			/>
			<form method="post" action="?/backdrop" use:enhance class="absolute right-2 bottom-2">
				<button
					class={[
						'rounded-md p-1.5 backdrop-blur-sm',
						data.isBackdrop
							? 'bg-amber-500 text-zinc-950'
							: 'bg-zinc-950/70 text-zinc-200 hover:bg-zinc-950'
					]}
					aria-pressed={data.isBackdrop}
					title={data.isBackdrop
						? 'Quitar esta imagen del fondo del recetario'
						: 'Poner esta imagen de fondo del recetario'}
					aria-label={data.isBackdrop
						? 'Quitar esta imagen del fondo del recetario'
						: 'Poner esta imagen de fondo del recetario'}
				>
					<svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true">
						<g
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<rect x="3" y="4" width="18" height="16" rx="2" />
							<circle cx="9" cy="10" r="1.5" />
							<path d="M21 16l-5-5-8 9" />
						</g>
					</svg>
				</button>
			</form>
		</div>
	{/if}
	<div class="min-w-0">
		<h1 class="text-2xl font-bold">{r.title}</h1>
		<p class="text-zinc-400">
			{#if r.servings}Para {r.servings} ·
			{/if}De
			<a href={r.sourceUrl} target="_blank" rel="noreferrer" class="hover:underline"
				>{r.sourceName}</a
			>
		</p>
		<div class="mt-4 flex flex-wrap items-center gap-2">
			<button
				class="rounded-md bg-amber-500 px-4 py-2 font-medium text-zinc-950 hover:bg-amber-400"
				onclick={cook}>🍳 Cocinar en este dispositivo</button
			>
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
