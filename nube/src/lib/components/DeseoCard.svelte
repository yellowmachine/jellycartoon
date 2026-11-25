<script lang="ts">
	import { enhance } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import { costText, priceChangeText, type WishCard } from '#lib/wishes.ts';

	/**
	 * A wish proposed by the AI in Preguntar (#586): a pasted link, read, and «Añadir» into whose list,
	 * through /preguntar's action from any page (the side panel, #504).
	 */
	let {
		card,
		message,
		index,
		ondone
	}: {
		card: WishCard;
		message: number;
		index: number;
		ondone?: (card: WishCard) => void;
	} = $props();

	let sending = $state(false);
	let problem = $state<string | null>(null);
	const price = $derived(costText(card));
	const there = $derived(card.added ?? card.already);
</script>

<form
	method="post"
	action="/preguntar?/wish"
	class="mt-2 flex gap-3 rounded-xl border border-zinc-700 bg-zinc-900/80 p-3"
	use:enhance={() => {
		sending = true;
		problem = null;
		// Not update(): from another page it would take there (Kit 3).
		return async ({ result }) => {
			sending = false;
			if (result.type === 'success' && result.data?.wish) {
				ondone?.(result.data.wish as WishCard);
				void refreshAll();
			} else
				problem =
					result.type === 'failure' ? String(result.data?.message ?? 'No se pudo') : 'No se pudo';
		};
	}}
>
	<input type="hidden" name="message" value={message} />
	<input type="hidden" name="card" value={index} />
	<div
		class="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-claro"
		aria-hidden="true"
	>
		{#if card.imageUrl}
			<img
				src={card.imageUrl}
				alt=""
				loading="lazy"
				referrerpolicy="no-referrer"
				class="h-full w-full object-contain"
			/>
		{:else}
			<SectionIcon name="deseos" class="h-8 w-8 text-zinc-400" />
		{/if}
	</div>
	<div class="min-w-0 flex-1">
		<a
			href={card.url}
			target="_blank"
			rel="noopener noreferrer"
			class="line-clamp-2 font-medium text-zinc-200 hover:underline">{card.title}</a
		>
		<p class="text-sm text-zinc-400">{card.shop}{price ? ` · ${price}` : ''}</p>
		{#if there}
			<p class="mt-1 text-sm text-emerald-400">
				✓ {card.added ? 'Añadido' : 'Ya estaba'} en la lista de {card.personName}{card.change
					? `: ${priceChangeText(card.change)}`
					: ''}
			</p>
			<a
				href="/deseos?persona={card.personId}&ya={there}"
				class="text-sm text-zinc-400 hover:underline">Ver en Deseos</a
			>
		{:else}
			<button
				class="mt-2 rounded-md bg-amber-500 px-4 py-1.5 font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
				disabled={sending}
				>{sending ? 'Un momento…' : `Añadir a la lista de ${card.personName}`}</button
			>
		{/if}
		{#if problem}<p class="mt-2 text-sm text-red-400">{problem}</p>{/if}
	</div>
</form>
