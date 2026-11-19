<script lang="ts">
	import type { Snippet } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { justSaved } from '#lib/chat-saved.svelte.ts';
	import { describeTimer } from 'comun/recipe.ts';
	import type { RecipeCard } from '#lib/chat.ts';
	import { vista } from '#lib/vista.svelte.ts';
	import { recipe as inProgress } from '#lib/recipe.svelte.ts';

	/**
	 * A recipe written by the AI (#470): its ingredients and steps, with «Guardar en Recetas» (into
	 * the family's book) and «Cocinar ahora» (the kitchen mode, as from Recetas). Saved through
	 * /preguntar's action from any page (the side panel, #504): `onsaved` gets its number there, and
	 * the page stays where it is, with its data read again (Recetas beside it shows the new one, and
	 * points it out: chat-saved.svelte.ts). In Mensajes (#555), a recipe that came, saved through
	 * its own action (`save`); and in the AI's panel there, only «Enviar» (`actions`).
	 */
	let {
		card,
		message,
		index,
		save,
		actions,
		onsaved
	}: {
		card: RecipeCard;
		message?: number;
		index?: number;
		/** Another action than Preguntar's, with its fields. */
		save?: { action: string; fields: Record<string, string> };
		/** In place of «Cocinar ahora» and «Guardar». */
		actions?: Snippet;
		onsaved?: (savedId: number) => void;
	} = $props();

	const r = $derived(card.recipe);
	let confirmReplace = $state(false);
	let saving = $state(false);
	let problem = $state<string | null>(null);

	function cook() {
		confirmReplace = false;
		void vista.cook(r);
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
		{#if actions}
			{@render actions()}
		{:else if confirmReplace}
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
		{#if actions}
			<!-- Only what the panel shows. -->
		{:else if card.savedId}
			<a
				href="/recetas/{card.savedId}"
				class="rounded-md px-3 py-1.5 text-sm text-emerald-400 hover:bg-zinc-800">En Recetas ✓</a
			>
		{:else}
			<form
				method="post"
				action={save?.action ?? '/preguntar?/save'}
				use:enhance={() => {
					saving = true;
					problem = null;
					// Not update(): from another page it would take there (Kit 3). invalidateAll() reads
					// the page beside it again without moving.
					return async ({ result }) => {
						saving = false;
						if (result.type === 'success' && typeof result.data?.savedId === 'number') {
							onsaved?.(result.data.savedId);
							justSaved.recipeId = result.data.savedId;
							void invalidateAll();
						} else problem = 'No se pudo guardar';
					};
				}}
			>
				{#if save}
					{#each Object.entries(save.fields) as [name, value] (name)}
						<input type="hidden" {name} {value} />
					{/each}
				{:else}
					<input type="hidden" name="message" value={message} />
					<input type="hidden" name="card" value={index} />
				{/if}
				<button
					class="rounded-md px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white"
					disabled={saving}>{saving ? 'Guardando…' : 'Guardar en Recetas'}</button
				>
			</form>
		{/if}
	</div>
	{#if problem}<p class="mt-2 text-sm text-red-400">{problem}</p>{/if}
</div>
