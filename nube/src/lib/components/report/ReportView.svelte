<script lang="ts">
	import BarsBlock from '#lib/components/BarsBlock.svelte';
	import TripMap from '#lib/components/TripMap.svelte';
	import type { Report } from '#lib/reports.ts';
	import AgendaBlock from './AgendaBlock.svelte';
	import ExpensesBlock from './ExpensesBlock.svelte';
	import PhotosBlock from './PhotosBlock.svelte';
	import StatsBlock from './StatsBlock.svelte';
	import WeatherBlock from './WeatherBlock.svelte';

	/** A report's pieces (#505): the AI's words, then each block drawn by Seilide. */
	let { report }: { report: Report } = $props();
</script>

<div class="flex flex-col gap-5">
	{#each report.pieces as p, i (i)}
		<section class="flex flex-col gap-2">
			{#if p.text}<p class="whitespace-pre-line text-zinc-200">{p.text}</p>{/if}
			{#if p.block?.kind === 'cifras'}
				<StatsBlock block={p.block} excluded={report.excluded} />
			{:else if p.block?.kind === 'mapa'}
				<TripMap pieces={p.block.ways} photos={p.block.photos} ends={false} />
			{:else if p.block?.kind === 'fotos'}
				<PhotosBlock block={p.block} />
			{:else if p.block?.kind === 'gastos'}
				<ExpensesBlock block={p.block} excluded={report.excluded} />
			{:else if p.block?.kind === 'barras'}
				<BarsBlock block={p.block} />
			{:else if p.block?.kind === 'agenda'}
				<AgendaBlock block={p.block} />
			{:else if p.block?.kind === 'tiempo'}
				<WeatherBlock block={p.block} />
			{:else if p.kind && p.empty}
				<p class="rounded-lg border border-dashed border-zinc-800 p-3 text-sm text-zinc-500">
					{p.empty}
				</p>
			{/if}
		</section>
	{/each}
</div>
