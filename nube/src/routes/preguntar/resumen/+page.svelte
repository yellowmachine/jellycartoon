<script lang="ts">
	import { enhance } from '$app/forms';
	import { monthName, monthOf } from 'comun/expenses.ts';
	import { sectionOn } from '#lib/nav.ts';
	import PreguntarTabs from '#lib/components/PreguntarTabs.svelte';
	import GuideLink from '#lib/components/GuideLink.svelte';
	import SummaryBlocks from '#lib/components/SummaryBlocks.svelte';
	import { daysText } from '#lib/report-days.ts';
	import {
		SUMMARY_BLOCKS,
		SUMMARY_VIEWS,
		summaryEmpty,
		type SummaryBlock,
		type SummaryView
	} from '#lib/summary.ts';
	import type { PageProps } from './$types';

	/** Preguntar → Resumen: figures, beside the period before; only what has something to say. */
	let { data, form }: PageProps = $props();

	/** Of a section the family, or they, took out: nor here. */
	const shows = (b: SummaryBlock) =>
		sectionOn(SUMMARY_BLOCKS[b].section, data.family?.sections, data.family?.mine);
	const s = $derived({
		period: data.period,
		money: shows('dinero') ? data.money : null,
		walks: shows('paseos') ? data.walks : null,
		charges: shows('fijos') ? data.charges : [],
		shopping: shows('compras') ? data.shopping : null,
		energy: shows('energia') ? data.energy : null,
		car: shows('coche') ? data.car : null,
		medication: shows('medicacion') ? data.medication : [],
		wishes: shows('deseos') ? data.wishes : null,
		past: shows('agenda') ? data.past : { days: [], more: 0, count: 0 },
		next: shows('agenda') ? data.next : null
	});
	const p = $derived(data.period);
	const views = Object.entries(SUMMARY_VIEWS) as [SummaryView, string][];
	const name = $derived(
		p.view === 'mes'
			? monthName(monthOf(p.from))
			: p.view === 'semana'
				? `Semana ${daysText(p.from, p.to)}`
				: daysText(p.from, p.to)
	);
	const arrow = 'rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900';
	let saving = $state(false);
</script>

<svelte:head><title>Resumen · Seilide</title></svelte:head>

<div class="mx-auto max-w-2xl">
	<h1 class="mb-3 text-2xl font-bold">
		Preguntar<GuideLink page="preguntar#resumen" label="el resumen" />
	</h1>
	<PreguntarTabs />

	<nav class="mb-4 flex flex-wrap gap-2" aria-label="Periodo">
		{#each views as [view, label] (view)}
			<a
				href="?ver={view}"
				class={[
					'rounded-full px-3 py-1 text-sm',
					view === p.view
						? 'bg-amber-500 font-medium text-zinc-950'
						: 'bg-zinc-800 hover:bg-zinc-700'
				]}
				aria-current={view === p.view ? 'page' : undefined}>{label}</a
			>
		{/each}
	</nav>

	<div class="mb-4 flex items-center gap-3">
		{#if p.before}
			<a href="?ver={p.view}&de={p.before}" class={arrow} aria-label="El anterior">←</a>
		{/if}
		<h2
			class="min-w-0 flex-1 text-lg font-semibold first-letter:uppercase {p.before
				? 'text-center'
				: ''}"
		>
			{name}
		</h2>
		{#if p.after}
			<a href="?ver={p.view}&de={p.after}" class={arrow} aria-label="El siguiente">→</a>
		{:else if p.before}
			<span class="{arrow} opacity-30" aria-hidden="true">→</span>
		{/if}
	</div>

	<SummaryBlocks {s} />

	{#if p.view !== 'dias' && !summaryEmpty(s)}
		<form
			method="post"
			action="?/guardar"
			class="mb-4"
			use:enhance={() => {
				saving = true;
				return async ({ update }) => {
					await update();
					saving = false;
				};
			}}
		>
			<input type="hidden" name="ver" value={p.view} />
			<input type="hidden" name="de" value={p.from} />
			<button
				class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-50"
				disabled={saving}>{saving ? 'Guardando…' : 'Guardar como informe'}</button
			>
			<span class="ml-2 text-xs text-zinc-500">Queda en Informes tal como está ahora.</span>
			{#if form?.message}<p class="mt-1 text-sm text-red-400" role="alert">{form.message}</p>{/if}
		</form>
	{/if}
	<p class="text-sm text-zinc-500">
		Qué sale aquí, y la tarjeta de la portada, en
		<a href="/ajustes?seccion=mi#resumen" class="text-amber-400 hover:underline">Ajustes</a>.
	</p>
</div>
