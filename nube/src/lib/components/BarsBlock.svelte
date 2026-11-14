<script lang="ts">
	import { euros } from 'comun/expenses.ts';
	import { seriesColor, type BarsBlock } from '#lib/blocks.ts';

	/**
	 * Stacked bars (#504 phase 3, #505): a column per month, a segment per series in its colour
	 * (blocks.ts: the dataviz palette, validated on the dark cards). Pointing at a column, or
	 * tapping it, says its month above; the legend names every colour, and «Ver las cifras» has
	 * them all as a table (for whoever cannot tell the colours apart, and to copy them).
	 */
	let { block }: { block: BarsBlock } = $props();

	const totals = $derived(
		block.labels.map((_, i) => block.series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0))
	);
	const highest = $derived(Math.max(...totals, 1));
	const periodTotal = $derived(totals.reduce((a, b) => a + b, 0));
	let picked = $state<number | null>(null);

	const monthLong = (m: string) =>
		new Date(`${m}-15T12:00:00Z`).toLocaleDateString('es-ES', {
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		});
	const monthShort = (m: string) =>
		new Date(`${m}-15T12:00:00Z`).toLocaleDateString('es-ES', { month: 'short', timeZone: 'UTC' });
	/** Under the columns, every name if they fit; with many months, January and every third. */
	const labelled = (i: number) =>
		block.labels.length <= 12 || i % 3 === 0 || block.labels[i]!.endsWith('-01');
</script>

<figure class="mt-2 rounded-xl border border-zinc-700 bg-zinc-900 p-3">
	<figcaption class="mb-1 font-semibold text-zinc-200">{block.title}</figcaption>
	<!-- The readout: the month pointed at, else the whole period. -->
	<p class="mb-3 min-h-10 text-sm text-zinc-400" aria-live="polite">
		{#if picked !== null}
			<span class="first-letter:uppercase">{monthLong(block.labels[picked]!)}</span>:
			<span class="font-semibold text-zinc-100 tabular-nums">{euros(totals[picked]!)}</span>
			{#each block.series.filter((s) => s.values[picked!]) as s (s.name)}
				{' · '}{s.name} <span class="tabular-nums">{euros(s.values[picked!]!)}</span>
			{/each}
		{:else}
			En total, <span class="font-semibold text-zinc-100 tabular-nums">{euros(periodTotal)}</span>
			{#if block.labels.length > 1}· toca un mes para verlo{/if}
		{/if}
	</p>

	<div
		class="flex h-40 items-end gap-1"
		role="group"
		aria-label={block.title}
		onmouseleave={() => (picked = null)}
	>
		{#each block.labels as label, i (label)}
			<button
				type="button"
				aria-label="{monthLong(label)}: {euros(totals[i]!)}"
				class="group flex h-full min-w-0 flex-1 flex-col justify-end"
				onmouseenter={() => (picked = i)}
				onfocus={() => (picked = i)}
				onclick={() => (picked = picked === i ? null : i)}
			>
				<!-- Segments bottom up, 2px of card between them; the column's top rounded. -->
				<span
					class={[
						'flex w-full flex-col-reverse gap-[2px] overflow-hidden rounded-t transition-opacity',
						picked !== null && picked !== i && 'opacity-50'
					]}
					style:height="{(totals[i]! / highest) * 100}%"
				>
					{#each block.series as s, j (s.name)}
						{#if s.values[i]}
							<span
								class="w-full shrink-0"
								style:height="{(s.values[i]! / totals[i]!) * 100}%"
								style:background-color={seriesColor(s.name, j)}
							></span>
						{/if}
					{/each}
				</span>
			</button>
		{/each}
	</div>
	<div class="mt-1 flex gap-1 border-t border-zinc-700 pt-1 text-[11px] text-zinc-500">
		{#each block.labels as label, i (label)}
			<span class="min-w-0 flex-1 truncate text-center">{labelled(i) ? monthShort(label) : ''}</span
			>
		{/each}
	</div>

	{#if block.series.length > 1}
		<ul class="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-300">
			{#each block.series as s, j (s.name)}
				<li class="flex items-center gap-1.5">
					<span
						class="size-2.5 shrink-0 rounded-sm"
						style:background-color={seriesColor(s.name, j)}
						aria-hidden="true"
					></span>{s.name}
				</li>
			{/each}
		</ul>
	{/if}

	<details class="mt-3 text-sm">
		<summary class="cursor-pointer text-zinc-400 hover:text-zinc-200">Ver las cifras</summary>
		<div class="mt-2 overflow-x-auto">
			<table class="w-full text-right text-xs whitespace-nowrap tabular-nums">
				<thead class="text-zinc-400">
					<tr>
						<th class="py-1 pr-2 text-left font-normal">Mes</th>
						{#each block.series as s (s.name)}<th class="px-1 py-1 font-normal">{s.name}</th>{/each}
						<th class="py-1 pl-2 font-normal">Total</th>
					</tr>
				</thead>
				<tbody class="text-zinc-200">
					{#each block.labels as label, i (label)}
						<tr class="border-t border-zinc-800">
							<td class="py-1 pr-2 text-left">{label}</td>
							{#each block.series as s (s.name)}<td class="px-1 py-1"
									>{s.values[i] ? euros(s.values[i]!) : '—'}</td
								>{/each}
							<td class="py-1 pl-2 font-semibold">{euros(totals[i]!)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</details>
</figure>
