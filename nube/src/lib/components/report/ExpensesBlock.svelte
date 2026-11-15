<script lang="ts">
	import { enhance } from '$app/forms';
	import { euros } from 'comun/expenses.ts';
	import { keptExpenses, type ExpensesBlock } from '#lib/reports.ts';

	/**
	 * A report's expenses (#505): by category, then one by one. They do not keep where they were
	 * made, only their day: «Quitar» takes away one that is not of this trip (bought online, at
	 * home), and it stays away when the report is brought up to date.
	 */
	let { block, excluded }: { block: ExpensesBlock; excluded: number[] } = $props();

	const kept = $derived(keptExpenses(block.items, excluded));
	const total = $derived(kept.reduce((s, e) => s + e.total, 0));
	const sums = $derived(
		[...Map.groupBy(kept, (e) => e.category)]
			.map(([category, list]) => ({ category, total: list.reduce((s, e) => s + e.total, 0) }))
			.sort((a, b) => b.total - a.total)
	);
	const largest = $derived(Math.max(...sums.map((s) => s.total), 1));
	const day = (d: string) =>
		new Date(`${d}T12:00:00Z`).toLocaleDateString('es-ES', {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			timeZone: 'UTC'
		});
</script>

<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
	<p class="mb-2 text-sm text-zinc-400">
		{kept.length}
		{kept.length === 1 ? 'gasto' : 'gastos'},
		<span class="font-semibold text-zinc-100 tabular-nums">{euros(total)}</span>
	</p>
	<ul class="mb-3 flex flex-col gap-1.5">
		{#each sums as s (s.category)}
			<li class="grid grid-cols-[7rem_1fr_auto] items-center gap-2 text-sm">
				<span class="truncate">{s.category}</span>
				<span class="h-2 overflow-hidden rounded-full bg-zinc-800">
					<span
						class="block h-full rounded-full bg-amber-500"
						style:width="{(Math.max(s.total, 0) / largest) * 100}%"
					></span>
				</span>
				<span class="text-right tabular-nums">{euros(s.total)}</span>
			</li>
		{/each}
	</ul>
	<p class="mb-2 text-xs text-zinc-500">
		Son todos los gastos de esos días: si alguno no es del viaje (por internet, de quien se quedó en
		casa), quítalo.
	</p>
	<ul class="divide-y divide-zinc-800 text-sm">
		{#each block.items as e (e.id)}
			{@const out = excluded.includes(e.id)}
			<li class={['flex items-center gap-2 py-1.5', out && 'text-zinc-600 line-through']}>
				<span class="w-20 shrink-0 text-zinc-500">{day(e.date)}</span>
				<span class="min-w-0 flex-1 truncate">{e.store}</span>
				<span class="shrink-0 tabular-nums">{euros(e.total)}</span>
				<form method="post" action="?/quitar" use:enhance class="shrink-0">
					<input type="hidden" name="expense" value={e.id} />
					<input type="hidden" name="out" value={out ? '0' : '1'} />
					<button
						class="rounded-md px-2 py-0.5 text-xs text-zinc-400 no-underline hover:bg-zinc-800 hover:text-white"
						>{out ? 'Volver a poner' : 'Quitar'}</button
					>
				</form>
			</li>
		{/each}
	</ul>
</div>
