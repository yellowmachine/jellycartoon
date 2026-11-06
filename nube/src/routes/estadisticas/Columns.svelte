<script lang="ts">
	import { timeWatched } from './time-watched.ts';

	/**
	 * One measure along time, in thin columns. Hovering or tapping one says it above; below, the same
	 * as a table, for who cannot tell a height.
	 */
	let {
		title,
		columns,
		ticks
	}: {
		title: string;
		columns: { key: string; label: string; seconds: number }[];
		/** The columns with their name under them, not to crowd a phone. */
		ticks: { key: string; label: string }[];
	} = $props();

	let picked = $state<string | null>(null);

	const top = $derived(Math.max(...columns.map((c) => c.seconds), 1));
	const shown = $derived(columns.find((c) => c.key === picked));
	const tickOf = $derived(new Map(ticks.map((t) => [t.key, t.label])));
</script>

<section class="mb-8">
	<div class="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
		<h2 class="font-semibold">{title}</h2>
		<p class="min-h-5 text-sm text-zinc-400" aria-live="polite">
			{#if shown}{shown.label}: {timeWatched(shown.seconds)}{/if}
		</p>
	</div>
	<div class="flex h-36 items-end gap-0.5 border-b border-zinc-700">
		{#each columns as column (column.key)}
			<button
				type="button"
				class="group flex h-full min-w-0 flex-1 items-end"
				aria-label="{column.label}: {timeWatched(column.seconds)}"
				onmouseenter={() => (picked = column.key)}
				onmouseleave={() => (picked = null)}
				onfocus={() => (picked = column.key)}
				onblur={() => (picked = null)}
				onclick={() => (picked = column.key)}
			>
				<span
					class="block w-full rounded-t bg-amber-600 group-hover:bg-amber-500 group-focus:bg-amber-500"
					style:height="{(column.seconds / top) * 100}%"
				></span>
			</button>
		{/each}
	</div>
	<div class="mt-1 flex gap-0.5 text-xs text-zinc-500" aria-hidden="true">
		{#each columns as column (column.key)}
			<span class="relative h-4 min-w-0 flex-1">
				{#if tickOf.has(column.key)}
					<span class="absolute left-0 whitespace-nowrap">{tickOf.get(column.key)}</span>
				{/if}
			</span>
		{/each}
	</div>
	<details class="mt-2 text-sm text-zinc-400">
		<summary class="cursor-pointer">Ver como tabla</summary>
		<table class="mt-2 w-full max-w-sm">
			<tbody>
				{#each columns as column (column.key)}
					<tr class="border-b border-zinc-800">
						<th scope="row" class="py-1 pr-3 text-left font-normal">{column.label}</th>
						<td class="py-1 text-right text-zinc-200">{timeWatched(column.seconds)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</details>
</section>
