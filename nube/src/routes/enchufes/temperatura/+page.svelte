<script lang="ts">
	import EnchufesTabs from '#lib/components/EnchufesTabs.svelte';
	import TemperatureChart from '#lib/components/TemperatureChart.svelte';
	import { TEMPERATURE_RANGES } from '#lib/temperature.ts';
	import type { PageProps } from './$types';

	/**
	 * Enchufes → Temperatura (#508): for now, outside where they live, as Open-Meteo estimates it;
	 * each room's sensor will have its card beside it and its line in the same chart.
	 */
	let { data }: PageProps = $props();
	const o = $derived(data.outside);

	const degrees = (c: number) =>
		`${c.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`;
	const RANGE_LABELS: Record<(typeof TEMPERATURE_RANGES)[number], string> = {
		2: '2 días',
		7: '7 días',
		30: '30 días'
	};
	const tab = 'rounded-md px-3 py-1.5 text-sm';
</script>

<svelte:head>
	<title>Temperatura · Energía · Seilide</title>
</svelte:head>

<h1 class="mb-3 text-2xl font-bold">Energía</h1>
<EnchufesTabs current="temperatura" />

{#if !data.place}
	<p class="text-zinc-400">
		Pon dónde vivís en <a
			href="/ajustes?seccion=familia#donde-vivis"
			class="text-amber-400 hover:underline">Ajustes</a
		> para ver aquí la temperatura de fuera.
	</p>
{:else if !o}
	<p class="text-zinc-400">No se pudo saber la temperatura de fuera. Prueba dentro de un rato.</p>
{:else}
	<section class="mb-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
		<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
			<p class="text-sm text-zinc-400">Fuera · {data.place}</p>
			<p class="mt-1 text-3xl font-semibold text-zinc-100 tabular-nums">{degrees(o.temperature)}</p>
			<p class="mt-1 text-sm text-zinc-400 tabular-nums">
				Humedad {o.humidity} % · hoy entre {o.min}° y {o.max}°
			</p>
		</div>
	</section>

	<div class="mb-2 flex items-center justify-between gap-2">
		<h2 class="font-semibold">Hora a hora</h2>
		<nav class="flex gap-1" aria-label="Cuánto tiempo">
			{#each TEMPERATURE_RANGES as d (d)}
				<a
					href="?dias={d}"
					class="{tab} {data.days === d
						? 'bg-zinc-100 text-zinc-900'
						: 'bg-zinc-800 hover:bg-zinc-700'}"
					aria-current={data.days === d ? 'page' : undefined}>{RANGE_LABELS[d]}</a
				>
			{/each}
		</nav>
	</div>
	<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
		<TemperatureChart
			series={[{ name: 'Fuera', points: o.hours, color: 'text-zinc-400', dashed: true }]}
		/>
	</div>
	<p class="mt-3 text-xs text-zinc-500">
		Fuera es la estimación de <a
			href="https://open-meteo.com/"
			target="_blank"
			rel="noopener"
			class="hover:text-white hover:underline">Open-Meteo</a
		> para el sitio de «Dónde vivís», no un termómetro: puede apartarse unos grados de tu calle.
	</p>
{/if}
