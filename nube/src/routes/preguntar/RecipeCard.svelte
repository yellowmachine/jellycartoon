<script lang="ts">
	import { enhance } from '$app/forms';
	import { describeTimer } from 'comun/recipe.ts';
	import type { RecipeCard } from '#lib/chat.ts';
	import { kitchenMode } from '#lib/kitchen-mode.svelte.ts';
	import { recipe as inProgress } from '#lib/recipe.svelte.ts';

	/**
	 * A recipe written by the AI (#470): its ingredients and steps, with «Guardar en Recetas» (into
	 * the family's book) and «Cocinar ahora» (the kitchen mode, as from Recetas).
	 */
	let { card, message, index }: { card: RecipeCard; message: number; index: number } = $props();

	const r = $derived(card.recipe);
	let confirmReplace = $state(false);
	let saving = $state(false);

	function cook() {
		confirmReplace = false;
		void kitchenMode.cook(r);
	}
</script>

<div class="mt-2 rounded-xl border border-zinc-700 bg-zinc-900/80 p-3">
	<p class="font-semibold">🍰 {r.title}</p>
	{#if r.servings}<p class="text-sm text-zinc-400">Para {r.servings}</p>{/if}

	<p class="mt-3 mb-1 text-sm font-semibold text-zinc-300">Ingredientes</p>
	<ul class="list-disc space-y-0.5 pl-5 text-zinc-300">
		{#each r.ingredients as ingredient, i (i)}<li>{ingredient}</li>{/each}
	</ul>

	<details class="mt-3">
		<summary class="cursor-pointer text-sm font-semibold text-zinc-300"
			>Pasos ({r.steps.length})</summary
		>
		<ol class="mt-2 space-y-2">
			{#each r.steps as step, i (i)}
				<li class="flex gap-2">
					<span class="w-5 shrink-0 text-right text-zinc-500">{i + 1}.</span>
					<span>
						{step.text}
						{#if step.timer}
							<span class="block text-sm text-amber-400">⏱ {describeTimer(step.timer)}</span>
						{/if}
					</span>
				</li>
			{/each}
		</ol>
	</details>

	<div class="mt-3 flex flex-wrap items-center gap-2">
		{#if confirmReplace}
			<span class="text-sm text-zinc-300">¿Dejar «{inProgress.current?.title}» y cocinar esta?</span
			>
			<button
				class="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-semibold text-zinc-950 hover:bg-amber-400"
				onclick={cook}>Sí</button
			>
			<button
				class="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800"
				onclick={() => (confirmReplace = false)}>No</button
			>
		{:else}
			<button
				class="rounded-md bg-amber-500 px-4 py-1.5 font-semibold text-zinc-950 hover:bg-amber-400"
				onclick={() => {
					if (inProgress.current && inProgress.current.title !== r.title) confirmReplace = true;
					else cook();
				}}>🍳 Cocinar ahora</button
			>
		{/if}
		{#if card.savedId}
			<a
				href="/recetas/{card.savedId}"
				class="rounded-md px-3 py-1.5 text-sm text-emerald-400 hover:bg-zinc-800">En Recetas ✓</a
			>
		{:else}
			<form
				method="post"
				action="?/save"
				use:enhance={() => {
					saving = true;
					return async ({ update }) => {
						saving = false;
						await update({ reset: false });
					};
				}}
			>
				<input type="hidden" name="message" value={message} />
				<input type="hidden" name="card" value={index} />
				<button
					class="rounded-md px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white"
					disabled={saving}>{saving ? 'Guardando…' : 'Guardar en Recetas'}</button
				>
			</form>
		{/if}
	</div>
</div>
