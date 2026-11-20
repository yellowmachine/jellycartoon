<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { itemSaid, type PlanCard } from '#lib/encargos.ts';

	/**
	 * Errands proposed by the AI in Preguntar (#557): each line with its check, all ticked at first;
	 * «Guardar» keeps the ticked ones through /preguntar's action, from any page (the side panel,
	 * #504): a notice as an alarm in the Agenda, one with a plug or a condition as a rule of one
	 * time in Reglas. Those kept show where they went.
	 */
	let {
		card,
		message,
		index,
		onsaved
	}: {
		card: PlanCard;
		message: number;
		index: number;
		onsaved?: (card: PlanCard) => void;
	} = $props();

	let ticked = $state<Record<number, boolean>>({});
	const isTicked = (i: number) => ticked[i] ?? true;
	const count = $derived(card.items.filter((it, i) => !it.savedId && isTicked(i)).length);

	let sending = $state(false);
	let problems = $state<string[]>([]);

	const icon = (it: PlanCard['items'][number]) =>
		it.kind === 'aviso' ? '⏰' : it.spec.then === 'enchufe' ? '🔌' : '🔔';
</script>

<form
	method="post"
	action="/preguntar?/plan"
	class="mt-2 rounded-xl border border-zinc-700 bg-zinc-900/80 p-3"
	use:enhance={() => {
		sending = true;
		problems = [];
		// Not update(): from another page it would take there (Kit 3).
		return async ({ result }) => {
			sending = false;
			if (result.type === 'failure') problems = [String(result.data?.message ?? 'No se pudo')];
			else if (result.type === 'success' && result.data?.plan) {
				ticked = {};
				onsaved?.(result.data.plan as PlanCard);
				problems = Array.isArray(result.data.problems) ? result.data.problems.map(String) : [];
				void invalidateAll();
			} else problems = ['No se pudo guardar'];
		};
	}}
>
	<input type="hidden" name="message" value={message} />
	<input type="hidden" name="card" value={index} />
	<p class="mb-2 text-sm font-semibold text-zinc-300">📋 Para dejar programado</p>
	<ul class="space-y-1">
		{#each card.items as it, i (i)}
			<li>
				{#if it.savedId}
					<span class="flex items-start gap-2 py-1 text-zinc-400">
						<span class="w-5 shrink-0 text-center text-emerald-500">✓</span>
						<span class="min-w-0 flex-1">{icon(it)} {itemSaid(it)}</span>
						<a
							href={it.kind === 'aviso' ? '/agenda/alarmas' : '/reglas'}
							class="shrink-0 text-xs text-emerald-400 hover:underline"
							>{it.kind === 'aviso' ? 'En la Agenda' : 'En Reglas'}</a
						>
					</span>
				{:else}
					<label class="flex cursor-pointer items-start gap-2 py-1">
						<input
							type="checkbox"
							name="item"
							value={i}
							checked={isTicked(i)}
							onchange={(e) => (ticked[i] = e.currentTarget.checked)}
							class="mt-0.5 size-5 shrink-0 rounded"
						/>
						<span class="min-w-0 flex-1">{icon(it)} {itemSaid(it)}</span>
					</label>
				{/if}
			</li>
		{/each}
	</ul>
	{#if card.items.some((it) => !it.savedId)}
		<button
			class="mt-3 rounded-md bg-amber-500 px-4 py-1.5 font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
			disabled={!count || sending}
			>{sending ? 'Guardando…' : count === 1 ? 'Guardar 1' : `Guardar ${count}`}</button
		>
	{:else}
		<p class="mt-2 text-sm text-emerald-400">Todo guardado ✓</p>
	{/if}
	{#each problems as problem, i (i)}<p class="mt-2 text-sm text-red-400">{problem}</p>{/each}
</form>
