<script lang="ts">
	import ChatRecipeCard from '#lib/components/ChatRecipeCard.svelte';
	import ShoppingCard from '#lib/components/ShoppingCard.svelte';
	import type { StoredMessage } from '#lib/mensajes/messenger.ts';

	/**
	 * Mensajes (#555): a recipe or a list sent in a message, as Preguntar shows them, to take with a
	 * touch into this person's own family: the recipe into Recetas (once per message) or cooked now,
	 * the list's ticked things onto the shopping list. In the same family that is referring: the book
	 * and the list are everyone's, so once one takes it, all see it taken; a linked family keeps its
	 * own copy.
	 */
	let {
		m,
		toBuy,
		saved
	}: {
		m: StoredMessage;
		toBuy: string[];
		/** Which of the family's recipes came in which message: saved by anyone of the family. */
		saved: Record<string, number>;
	} = $props();

	const from = $derived(`${m.conversationId}/${m.key}`);
	/** Saved from here just now, before the page's data is read again. */
	let justSaved = $state<number | null>(null);
	const savedId = $derived(saved[from] ?? justSaved);
	let added = $state<string[] | null>(null);
</script>

{#if m.card?.kind === 'receta'}
	<ChatRecipeCard
		card={{ kind: 'receta', recipe: m.card.recipe, savedId }}
		save={{
			action: '?/save',
			fields: { recipe: JSON.stringify(m.card.recipe), from }
		}}
		onsaved={(id) => (justSaved = id)}
	/>
{:else if m.card?.kind === 'enlace-receta'}
	<!-- One of the family's own book: only which (the same family refers, #555). -->
	<div class="rounded-xl border border-zinc-700 bg-zinc-900/80 p-3">
		<p class="font-semibold">🍰 {m.card.title}</p>
		<p class="text-sm text-zinc-400">En vuestro recetario</p>
		<a
			href="/recetas/{m.card.id}"
			class="mt-2 inline-block rounded-md bg-amber-500 px-4 py-1.5 font-semibold text-zinc-950 hover:bg-amber-400"
			>Abrir la receta</a
		>
	</div>
{:else if m.card?.kind === 'compra'}
	<ShoppingCard
		items={m.card.items}
		{added}
		{toBuy}
		action="?/add"
		onadded={(data) => (added = Array.isArray(data?.added) ? (data.added as string[]) : added)}
	/>
{/if}
