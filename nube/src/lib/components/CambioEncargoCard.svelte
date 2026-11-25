<script lang="ts">
	import { enhance } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import { changeSaid, type ErrandChangeCard } from '#lib/encargos.ts';

	/**
	 * A change to an errand proposed by the AI in Preguntar (#557, phase 3): the errand as it is,
	 * what would change (another day or time, or cancelled), and «Confirmar», through /preguntar's
	 * action from any page (the side panel, #504). Done, it says so.
	 */
	let {
		card,
		message,
		index,
		ondone
	}: {
		card: ErrandChangeCard;
		message: number;
		index: number;
		ondone?: (card: ErrandChangeCard) => void;
	} = $props();

	let sending = $state(false);
	let problem = $state<string | null>(null);
</script>

<form
	method="post"
	action="/preguntar?/change"
	class="mt-2 rounded-xl border border-zinc-700 bg-zinc-900/80 p-3"
	use:enhance={() => {
		sending = true;
		problem = null;
		// Not update(): from another page it would take there (Kit 3).
		return async ({ result }) => {
			sending = false;
			if (result.type === 'success' && result.data?.change) {
				ondone?.(result.data.change as ErrandChangeCard);
				void refreshAll();
			} else
				problem =
					result.type === 'failure' ? String(result.data?.message ?? 'No se pudo') : 'No se pudo';
		};
	}}
>
	<input type="hidden" name="message" value={message} />
	<input type="hidden" name="card" value={index} />
	<p class="text-sm font-semibold text-zinc-300">📋 Encargo</p>
	<p class="mt-1 text-zinc-200">{card.said}</p>
	<p class="mt-1 text-sm {card.cancel ? 'text-red-300' : 'text-amber-300'}">→ {changeSaid(card)}</p>
	{#if card.done}
		<p class="mt-2 text-sm text-emerald-400">
			{card.cancel ? 'Cancelado ✓' : 'Cambiado ✓'}
			<a href="/reglas?ver=encargos" class="ml-2 hover:underline">Ver encargos</a>
		</p>
	{:else}
		<button
			class="mt-3 rounded-md px-4 py-1.5 font-semibold text-zinc-950 disabled:opacity-40 {card.cancel
				? 'bg-red-400 hover:bg-red-300'
				: 'bg-amber-500 hover:bg-amber-400'}"
			disabled={sending}
			>{sending ? 'Un momento…' : card.cancel ? 'Cancelar el encargo' : 'Confirmar'}</button
		>
	{/if}
	{#if problem}<p class="mt-2 text-sm text-red-400">{problem}</p>{/if}
</form>
