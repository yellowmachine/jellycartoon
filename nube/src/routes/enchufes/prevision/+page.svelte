<script lang="ts">
	import DegreeDayBars from '#lib/components/DegreeDayBars.svelte';
	import EnchufesTabs from '#lib/components/EnchufesTabs.svelte';
	import { SURE_DAYS } from '#lib/energy-forecast.ts';
	import { euroText } from '#lib/plugs.ts';
	import type { PageProps } from './$types';

	/**
	 * Energía → Previsión (#513, phase 1): the cold of the next days and the light it will take,
	 * learned from the plugs (what is plugged in) and from the light bills (the whole house).
	 */
	let { data }: PageProps = $props();
	const f = $derived(typeof data.forecast === 'object' ? data.forecast : null);

	const n0 = (n: number) => Math.round(n).toLocaleString('es-ES');
	const n1 = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 1 });
	const n2 = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 2 });
	const colder = $derived.by(() => {
		if (!f || f.degreesBefore === null) return null;
		const diff = f.degrees - f.degreesBefore;
		if (Math.abs(diff) < Math.max(3, f.degreesBefore * 0.1)) return 'parecido a los últimos días';
		return diff > 0 ? 'más frío que los últimos días' : 'menos frío que los últimos días';
	});
</script>

<svelte:head>
	<title>Previsión · Energía · Seilide</title>
</svelte:head>

<h1 class="mb-3 text-2xl font-bold">Energía</h1>
<EnchufesTabs current="prevision" />

{#if data.forecast === null}
	<p class="text-zinc-400">
		Pon dónde vivís en <a
			href="/ajustes?seccion=familia#donde-vivis"
			class="text-amber-400 hover:underline">Ajustes</a
		> para ver la previsión.
	</p>
{:else if typeof data.forecast === 'string'}
	<p class="text-zinc-400">{data.forecast}</p>
{:else if f}
	<section class="mb-6">
		<h2 class="font-semibold">El frío de los próximos {f.days.length} días</h2>
		<p class="mb-3 text-sm text-zinc-400">
			{n0(f.degrees)} grados-día de calefacción en {f.place}{#if colder}: {colder} (llevan {n0(
					f.degreesBefore ?? 0
				)}){/if}.
		</p>
		<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
			<DegreeDayBars days={f.days} />
		</div>
		<p class="mt-2 text-xs text-zinc-500">
			Un grado-día es un grado de frío durante un día, como los cuenta Eurostat: 18 °C menos la
			media del día cuando baja de 15 °C. Pasada la primera semana ({SURE_DAYS} días), la previsión es
			menos segura (barras más apagadas).
		</p>
	</section>

	{#snippet way(title: string, about: string, w: typeof f.plugs, learning: string, from: string)}
		<section class="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
			<h3 class="font-semibold">{title}</h3>
			<p class="mb-2 text-xs text-zinc-500">{about}</p>
			{#if w && 'learned' in w}
				{@const l = w.learned}
				<p class="text-2xl font-semibold text-zinc-100 tabular-nums">
					unos {n0(l.expected.kwh)} kWh{#if l.euros}<span class="text-zinc-400">
							{' · '}{euroText(l.euros.kwh)}</span
						>{/if}
				</p>
				<p class="text-sm text-zinc-400 tabular-nums">
					entre {n0(l.expected.low)} y {n0(l.expected.high)} kWh{#if l.euros}{' '}({euroText(
							l.euros.low
						)} a {euroText(l.euros.high)}){/if}
				</p>
				<p class="mt-2 text-xs text-zinc-500">
					Aprendido de {l.fit.n}
					{from}:
					{#if l.fit.perDegree > 0}
						{n1(l.fit.base)} kWh al día sin frío y {n2(l.fit.perDegree)} más por cada grado-día.
					{:else}
						unos {n1(l.fit.base)} kWh al día; el frío apenas cambia lo que gasta.
					{/if}
					{#if !l.euros}Sin precio del kWh: ponlo en Enchufes o lee una factura de la luz.{/if}
				</p>
			{:else if w}
				<p class="text-sm text-zinc-400">{learning} (llevas {w.have} de {w.need}).</p>
			{/if}
		</section>
	{/snippet}

	<h2 class="mb-2 font-semibold">La luz de esos días</h2>
	{#if !f.plugs && !f.bills}
		<p class="text-sm text-zinc-400">
			Para prever la luz hace falta de dónde aprender: enchufes en Enchufes, o facturas de la luz
			leídas en Dinero.
		</p>
	{:else}
		<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
			{#if f.plugs}
				{@render way(
					'Lo enchufado',
					'Solo lo que va en los enchufes de Seilide, día a día.',
					f.plugs,
					'Aún aprendiendo: hacen falta dos semanas de enchufes',
					'días'
				)}
			{/if}
			{#if f.bills}
				{@render way(
					'Toda la casa',
					'Según las facturas de la luz leídas en Dinero: la casa entera, una cifra por factura.',
					f.bills,
					'Aún aprendiendo: hacen falta tres facturas de la luz leídas en Dinero',
					'facturas'
				)}
			{/if}
		</div>
		<p class="mt-3 text-xs text-zinc-500">
			Una estimación con lo gastado otras veces con el mismo frío: lo que cambie en casa (un aparato
			nuevo, más gente) la mueve. Un día sin datos de un enchufe (apagado o sin conexión) cuenta
			como que no gastó.
		</p>
	{/if}
{/if}
