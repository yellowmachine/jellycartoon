<script lang="ts">
	import { FUEL_KINDS } from '#lib/fuel.ts';
	import { euroText } from '#lib/plugs.ts';
	import type { EnergyBlock } from '#lib/reports.ts';

	/**
	 * The house's energy over a report's days (#513): each day what the plugs used against its cold
	 * (heating degree-days), and the butane bottles or pellet sacks started.
	 */
	let { block }: { block: EnergyBlock } = $props();

	const day = (d: string) =>
		new Date(`${d}T12:00:00Z`).toLocaleDateString('es-ES', {
			weekday: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		});
	const n1 = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 1 });
	const plugs = $derived(block.days.some((d) => d.kwh !== null));
	const kwh = $derived(block.days.reduce((s, d) => s + (d.kwh ?? 0), 0));
	const degrees = $derived(block.days.reduce((s, d) => s + (d.degrees ?? 0), 0));
	const topKwh = $derived(Math.max(0.1, ...block.days.map((d) => d.kwh ?? 0)));
	const topDegrees = $derived(Math.max(1, ...block.days.map((d) => d.degrees ?? 0)));
</script>

<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
	<p class="text-sm text-zinc-300 tabular-nums">
		{#if plugs}Enchufes: {n1(kwh)} kWh{#if block.price}{' '}({euroText(
					kwh * block.price
				)}){/if}.{/if}
		{Math.round(degrees)} grados-día de frío{#if block.place}{' '}en {block.place}{/if}.
		{#each block.fuels as f (f.kind)}
			{f.units}
			{f.units === 1 ? FUEL_KINDS[f.kind].unit : FUEL_KINDS[f.kind].units} de {FUEL_KINDS[
				f.kind
			].name.toLowerCase()} empezad{FUEL_KINDS[f.kind].unit === 'saco' ? 'o' : 'a'}{f.units === 1
				? ''
				: 's'}.
		{/each}
	</p>
	<table class="mt-2 w-full text-sm tabular-nums">
		<tbody>
			{#each block.days as d (d.day)}
				<tr class="text-zinc-300">
					<td class="py-0.5 pr-2 whitespace-nowrap">{day(d.day)}</td>
					<td class="w-full py-0.5">
						{#if d.kwh !== null}
							<div
								class="h-2 rounded-sm bg-amber-400"
								style:width="{(d.kwh / topKwh) * 100}%"
								title="{n1(d.kwh)} kWh"
							></div>
						{/if}
						{#if d.degrees !== null}
							<div
								class="mt-0.5 h-1 rounded-sm bg-sky-500"
								style:width="{(d.degrees / topDegrees) * 100}%"
								title="{n1(d.degrees)} grados-día"
							></div>
						{/if}
					</td>
					<td class="pl-2 text-right whitespace-nowrap"
						>{d.kwh !== null ? `${n1(d.kwh)} kWh` : ''}</td
					>
				</tr>
			{/each}
		</tbody>
	</table>
	<p class="mt-1 text-xs text-zinc-500">
		{#if plugs}Amarillo, lo que gastaron los enchufes; azul,{:else}Azul,{/if} el frío de cada día (grados-día).
	</p>
</div>
