<script lang="ts">
	import { enhance } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import { skipTitle, type PlugSkipCard } from '#lib/plug-pause.ts';

	/**
	 * A plug's schedules skipped for a while, proposed by the AI in Preguntar (#557: «que no se
	 * encienda el termo esta tarde»): the while, the switch-ons it leaves out, and «Confirmar»,
	 * through /preguntar's action from any page (the side panel, #504). Done, what happened.
	 */
	let {
		card,
		message,
		index,
		ondone
	}: {
		card: PlugSkipCard;
		message: number;
		index: number;
		ondone?: (card: PlugSkipCard) => void;
	} = $props();

	let sending = $state(false);
	let problem = $state<string | null>(null);
</script>

<form
	method="post"
	action="/preguntar?/skip"
	class="mt-2 rounded-xl border border-zinc-700 bg-zinc-900/80 p-3"
	use:enhance={() => {
		sending = true;
		problem = null;
		// Not update(): from another page it would take there (Kit 3).
		return async ({ result }) => {
			sending = false;
			if (result.type === 'success' && result.data?.skip) {
				ondone?.(result.data.skip as PlugSkipCard);
				void refreshAll();
			} else
				problem =
					result.type === 'failure' ? String(result.data?.message ?? 'No se pudo') : 'No se pudo';
		};
	}}
>
	<input type="hidden" name="message" value={message} />
	<input type="hidden" name="card" value={index} />
	<p class="text-sm font-semibold text-zinc-300">🔌 Enchufe</p>
	<p class="mt-1 text-zinc-200">{skipTitle(card)}</p>
	{#if !card.done}
		{#if card.skipped}<p class="mt-1 text-sm text-amber-300">{card.skipped}</p>{/if}
		<p class="mt-1 text-xs text-zinc-500">
			{card.from
				? 'Sin apagarlo ni impedir encenderlo a mano; luego vuelven sus horarios.'
				: 'Sus horarios vuelven a encenderlo desde ya.'}
		</p>
		<button
			class="mt-3 rounded-md bg-amber-500 px-4 py-1.5 font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
			disabled={sending}>{sending ? 'Un momento…' : 'Confirmar'}</button
		>
	{:else}
		<p class="mt-2 text-sm text-emerald-400">✓ {card.result}</p>
		<a href="/enchufes" class="mt-1 inline-block text-sm text-zinc-400 hover:underline"
			>Ver en Enchufes</a
		>
	{/if}
	{#if problem}<p class="mt-2 text-sm text-red-400">{problem}</p>{/if}
</form>
