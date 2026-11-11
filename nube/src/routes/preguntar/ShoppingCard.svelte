<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ShoppingCard } from '#lib/chat.ts';

	/**
	 * Things to buy, proposed by the AI (#470): each with its check, all ticked but what is already
	 * on the list; «Añadir» puts the ticked ones on the family's shopping list. Those added stay
	 * marked, and the rest can still be added later.
	 */
	let {
		card,
		message,
		index,
		toBuy
	}: { card: ShoppingCard; message: number; index: number; toBuy: string[] } = $props();

	const fold = (text: string) =>
		text
			.normalize('NFD')
			.replace(/\p{M}/gu, '')
			.toLowerCase()
			.replace(/\s*\(.*\)\s*$/, '')
			.trim();

	const added = $derived(new Set(card.added ?? []));
	/** On the list already, by its name without the amount: «Harina (1 kg)» is «harina». */
	const listed = $derived(new Set(toBuy.map(fold)));
	const onList = (item: string) => added.has(item) || listed.has(fold(item));

	// What is ticked: at first everything not on the list; then, what the person changes.
	let ticked = $state<Record<string, boolean>>({});
	const isTicked = (item: string) => ticked[item] ?? (card.added === null && !onList(item));
	const count = $derived(card.items.filter((i) => !onList(i) && isTicked(i)).length);

	let sending = $state(false);
	let problem = $state<string | null>(null);
</script>

<form
	method="post"
	action="?/add"
	class="mt-2 rounded-xl border border-zinc-700 bg-zinc-900/80 p-3"
	use:enhance={() => {
		sending = true;
		problem = null;
		return async ({ result, update }) => {
			sending = false;
			if (result.type === 'failure') problem = String(result.data?.message ?? 'No se pudo');
			else {
				ticked = {};
				await update({ reset: false });
			}
		};
	}}
>
	<input type="hidden" name="message" value={message} />
	<input type="hidden" name="card" value={index} />
	<p class="mb-2 text-sm font-semibold text-zinc-300">🛒 Para la lista de la compra</p>
	<ul class="space-y-1">
		{#each card.items as item (item)}
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
					</label>
				{/if}
			</li>
		{/each}
	</ul>
	{#if card.items.some((i) => !onList(i))}
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
