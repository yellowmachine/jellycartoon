<script lang="ts">
	import { skyIcon } from 'comun/weather.ts';
	import type { WeatherBlock } from '#lib/reports.ts';

	/** The weather it was each day where they were (#505), as Open-Meteo forecast it then. */
	let { block }: { block: WeatherBlock } = $props();

	const day = (d: string) =>
		new Date(`${d}T12:00:00Z`).toLocaleDateString('es-ES', {
			weekday: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		});
</script>

<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
	{#if block.place}<p class="mb-2 text-sm text-zinc-400">En {block.place}</p>{/if}
	<ul class="flex gap-2 overflow-x-auto pb-1">
		{#each block.days as d (d.day)}
			<li class="flex w-20 shrink-0 flex-col items-center rounded-lg bg-zinc-800/60 p-2 text-sm">
				<span class="text-zinc-400">{day(d.day)}</span>
				<span class="text-2xl" title={d.sky} aria-label={d.sky}>{skyIcon(d.code)}</span>
				<span class="tabular-nums"
					><span class="text-zinc-400">{d.min}°</span> /
					<span class="text-zinc-100">{d.max}°</span></span
				>
				{#if d.rain}<span class="text-xs text-sky-400 tabular-nums">{d.rain} mm</span>{/if}
			</li>
		{/each}
	</ul>
</div>
