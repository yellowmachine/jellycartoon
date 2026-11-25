<!--
@component
«¿Reúne gastos ya apuntados?», on a bill or a payment: those of the days around, to choose by hand
when nothing was proposed.
-->
<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { euros } from 'comun/expenses.ts';
	import type { MergeNotice } from 'comun/page-notices.ts';

	interface Props {
		/** Its day. */
		day: string;
		/** Its total, in cents; null, not known yet. */
		total: number | null;
		/** Itself, if it is saved. */
		except?: number;
		onchosen: (parts: MergeNotice) => void;
	}
	let { day, total, except, onchosen }: Props = $props();

	let list = $state<MergeNotice | null>(null);
	let loading = $state(false);
	let problem = $state<string | null>(null);
	const picked = new SvelteSet<number>();
	const chosen = $derived((list ?? []).filter((p) => picked.has(p.id)));
	const sum = $derived(chosen.reduce((s, p) => s + p.total, 0));

	async function load() {
		loading = true;
		problem = null;
		const res = await fetch(`/gastos/juntables?dia=${day}`).catch(() => null);
		loading = false;
		if (!res?.ok) return void (problem = 'No se pudieron buscar');
		picked.clear();
		list = ((await res.json()) as MergeNotice).filter((p) => p.id !== except);
	}

	const shortDay = (d: string) =>
		new Date(`${d}T12:00:00Z`).toLocaleDateString('es-ES', {
			day: 'numeric',
			month: 'short',
			timeZone: 'UTC'
		});
	const button = 'rounded-md px-3 py-1.5 text-sm';
</script>

{#if !list}
	<button
		type="button"
		class="text-sm text-amber-400 hover:underline"
		disabled={loading}
		onclick={load}>{loading ? 'Buscando…' : '¿Reúne gastos ya apuntados?'}</button
	>
	{#if problem}<span class="ml-2 text-sm text-red-400" role="alert">{problem}</span>{/if}
{:else}
	<div class="rounded-md border border-zinc-700 p-3 text-sm">
		{#if list.length}
			<p class="mb-2 text-zinc-300">Marca los que van en este: quedará uno solo.</p>
			<ul class="max-h-60 divide-y divide-zinc-800 overflow-y-auto">
				{#each list as p (p.id)}
					<li>
						<label class="flex items-center gap-3 py-2">
							<input
								type="checkbox"
								checked={picked.has(p.id)}
								onchange={(e) => (e.currentTarget.checked ? picked.add(p.id) : picked.delete(p.id))}
								class="rounded border-zinc-600 bg-zinc-950 text-amber-500"
							/>
							<span class="min-w-0 flex-1">
								<span class="block truncate">{p.text}</span>
								<span class="block truncate text-xs text-zinc-500"
									>{shortDay(p.date)}{p.store === p.text ? '' : ` · ${p.store}`}</span
								>
							</span>
							<span class="shrink-0 tabular-nums">{euros(p.total)}</span>
						</label>
					</li>
				{/each}
			</ul>
			{#if chosen.length}
				<p class="mt-2 text-zinc-400" role="status">
					{euros(sum)} de {total === null ? 'un total sin poner' : euros(total)}{total !== null &&
					total !== sum
						? `: ${euros(Math.abs(total - sum))} ${total > sum ? 'más en este' : 'menos en este'}, que es el que queda`
						: ''}
				</p>
			{/if}
		{:else}
			<p class="text-zinc-400">
				No hay ninguno por esos días, a mano y sin recibo. Los regalos a otro adulto no salen.
			</p>
		{/if}
		<div class="mt-2 flex flex-wrap gap-2">
			{#if list.length}
				<button
					type="button"
					class="{button} bg-sky-700 font-semibold text-claro hover:bg-sky-600 disabled:opacity-50"
					disabled={!chosen.length || chosen.length > 20}
					onclick={() => {
						onchosen(chosen);
						list = null;
					}}>{chosen.length > 1 ? `Juntar los ${chosen.length} aquí` : 'Juntarlo aquí'}</button
				>
			{/if}
			<button type="button" class="{button} hover:bg-zinc-800" onclick={() => (list = null)}
				>Cerrar</button
			>
		</div>
	</div>
{/if}
