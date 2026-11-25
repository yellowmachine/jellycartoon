<script lang="ts">
	import { enhance } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import { pauseSaid, type PlugPauseCard } from '#lib/plug-pause.ts';

	/**
	 * A plug's pause proposed by the AI in Preguntar (#557): what would be done and «Confirmar»,
	 * through /preguntar's action from any page (the side panel, #504). Done, what happened (a
	 * water heater out of a long pause says it heats first).
	 */
	let {
		card,
		message,
		index,
		ondone
	}: {
		card: PlugPauseCard;
		message: number;
		index: number;
		ondone?: (card: PlugPauseCard) => void;
	} = $props();

	let sending = $state(false);
	let problem = $state<string | null>(null);
</script>

<form
	method="post"
	action="/preguntar?/pause"
	class="mt-2 rounded-xl border border-zinc-700 bg-zinc-900/80 p-3"
	use:enhance={() => {
		sending = true;
		problem = null;
		// Not update(): from another page it would take there (Kit 3).
		return async ({ result }) => {
			sending = false;
			if (result.type === 'success' && result.data?.pause) {
				ondone?.(result.data.pause as PlugPauseCard);
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
	<p class="mt-1 text-zinc-200">{pauseSaid(card)}</p>
	{#if !card.done}
		<p class="mt-1 text-xs text-zinc-500">
			{card.paused
				? 'Se apaga y no siguen sus horarios hasta quitarla.'
				: 'Vuelven sus horarios. Un termo tras una pausa larga calienta unas horas seguidas.'}
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
