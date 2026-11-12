<script lang="ts">
	import { enhance } from '$app/forms';
	import type { Snippet } from 'svelte';

	/**
	 * Things to buy, each with its check: all ticked but what is already on the list (and `usual`,
	 * what nearly every house has); «Añadir» posts the ticked ones as `item` to `action`, which puts
	 * them on the family's shopping list. Those added stay marked, and the rest can still be added
	 * later. The AI's in «Preguntar» (#470) and a recipe's «Añadir a la compra»; `children`, the
	 * form's own hidden fields.
	 */
	let {
		items,
		added = null,
		usual = [],
		toBuy,
		action = '?/add',
		onadded,
		children
	}: {
		items: string[];
		/** What went onto the list from here (null, nothing yet). */
		added?: string[] | null;
		/** Shown but not ticked at first: salt, oil… */
		usual?: string[];
		toBuy: string[];
		action?: string;
		/** After adding, what the action answered. */
		onadded?: (data: Record<string, unknown> | undefined) => void;
		children?: Snippet;
	} = $props();

	const fold = (text: string) =>
		text
			.normalize('NFD')
			.replace(/\p{M}/gu, '')
			.toLowerCase()
			.replace(/\s*\(.*\)\s*$/, '')
			.trim();

	const addedSet = $derived(new Set(added ?? []));
	const usualSet = $derived(new Set(usual));
	/** On the list already, by its name without the amount: «Harina (1 kg)» is «harina». */
	const listed = $derived(new Set(toBuy.map(fold)));
	const onList = (item: string) => addedSet.has(item) || listed.has(fold(item));

	// What is ticked: at first everything not on the list nor usual; then, what the person changes.
	let ticked = $state<Record<string, boolean>>({});
	const isTicked = (item: string) =>
		ticked[item] ?? (added === null && !onList(item) && !usualSet.has(item));
	const count = $derived(items.filter((i) => !onList(i) && isTicked(i)).length);

	let sending = $state(false);
	let problem = $state<string | null>(null);
</script>

<form
	method="post"
	{action}
	class="mt-2 rounded-xl border border-zinc-700 bg-zinc-900/80 p-3"
	use:enhance={() => {
		sending = true;
		problem = null;
		return async ({ result, update }) => {
			sending = false;
			if (result.type === 'failure') problem = String(result.data?.message ?? 'No se pudo');
			else {
				ticked = {};
				if (result.type === 'success') onadded?.(result.data);
				await update({ reset: false });
			}
		};
	}}
>
	{@render children?.()}
	<p class="mb-2 text-sm font-semibold text-zinc-300">🛒 Para la lista de la compra</p>
	<ul class="space-y-1">
		{#each items as item (item)}
			<li>
				{#if onList(item)}
					<span class="flex items-center gap-2 py-1 text-zinc-500">
						<span class="w-5 text-center text-emerald-500">✓</span>
						<span class="min-w-0 flex-1">{item}</span>
						<span class="text-xs">en la lista</span>
					</span>
				{:else}
					<label class="flex cursor-pointer items-center gap-2 py-1">
						<input
							type="checkbox"
							name="item"
							value={item}
							checked={isTicked(item)}
							onchange={(e) => (ticked[item] = e.currentTarget.checked)}
							class="size-5 rounded"
						/>
						<span class="min-w-0 flex-1">{item}</span>
						{#if usualSet.has(item)}<span class="text-xs text-zinc-500">¿lo tienes?</span>{/if}
					</label>
				{/if}
			</li>
		{/each}
	</ul>
	{#if items.some((i) => !onList(i))}
		<button
			class="mt-3 rounded-md bg-amber-500 px-4 py-1.5 font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
			disabled={!count || sending}
			>{sending
				? 'Añadiendo…'
				: count === 1
					? 'Añadir 1 a la lista'
					: `Añadir ${count} a la lista`}</button
		>
	{:else}
		<p class="mt-2 text-sm text-emerald-400">Todo en la lista ✓</p>
	{/if}
	{#if problem}<p class="mt-2 text-sm text-red-400">{problem}</p>{/if}
</form>
