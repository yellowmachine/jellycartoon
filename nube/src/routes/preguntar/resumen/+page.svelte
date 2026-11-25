<script lang="ts">
	import { euros, monthName, monthOf } from 'comun/expenses.ts';
	import PreguntarTabs from '#lib/components/PreguntarTabs.svelte';
	import { chargesSummary, chargeText, inDays } from '#lib/charges.ts';
	import { daysText } from '#lib/report-days.ts';
	import { changeText, SUMMARY_VIEWS, type SummaryView } from '#lib/summary.ts';
	import { durationText } from '#lib/trips.ts';
	import { kcalText } from '#lib/walk-kcal.ts';
	import { walkDistanceText } from '#lib/walks.ts';
	import type { PageProps } from './$types';

	/** Preguntar → Resumen: figures, beside the period before; only what has something to say. */
	let { data }: PageProps = $props();

	const p = $derived(data.period);
	const views = Object.entries(SUMMARY_VIEWS) as [SummaryView, string][];
	const name = $derived(
		p.view === 'mes'
			? monthName(monthOf(p.from))
			: p.view === 'semana'
				? `Semana ${daysText(p.from, p.to)}`
				: daysText(p.from, p.to)
	);
	const than = $derived(
		p.view === 'mes'
			? monthName(monthOf(p.prevFrom))
			: p.view === 'semana'
				? 'la semana antes'
				: 'los 7 días antes'
	);
	/** «142,00 € (los 7 días antes, 173,00 €: −18 %)». */
	const against = (
		now: number,
		before: number | null,
		least: number,
		text: (n: number) => string
	) => {
		if (before === null) return null;
		const change = changeText(now, before, least);
		return `${than}, ${text(before)}${change ? ` (${change})` : ''}`;
	};
	const day = (d: string) =>
		new Date(`${d}T12:00:00Z`).toLocaleDateString('es-ES', {
			weekday: 'short',
			day: 'numeric',
			month: p.view === 'mes' ? undefined : 'short',
			timeZone: 'UTC'
		});
	const largest = $derived(Math.max(1, ...(data.money?.categories ?? []).map((c) => c.total)));
	const empty = $derived(
		!data.money && !data.walks && !data.past.count && !data.next?.count && !data.charges.length
	);
	const card = 'mb-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4';
	const arrow = 'rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900';
</script>

<svelte:head><title>Resumen · Seilide</title></svelte:head>

{#snippet events(days: { day: string; events: string[] }[], more: number)}
	<ul class="flex flex-col gap-1 text-sm">
		{#each days as d (d.day)}
			<li class="flex gap-3">
				<a href="/agenda?dia={d.day}" class="w-20 shrink-0 text-zinc-400 hover:underline"
					>{day(d.day)}</a
				>
				<ul class="min-w-0 flex-1">
					{#each d.events as e, i (i)}<li>{e}</li>{/each}
				</ul>
			</li>
		{/each}
	</ul>
	{#if more}<p class="mt-1 text-sm text-zinc-500">y {more} más</p>{/if}
{/snippet}

<div class="mx-auto max-w-2xl">
	<h1 class="mb-3 text-2xl font-bold">Preguntar</h1>
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

	{#if empty}
		<p class="text-zinc-400">No hay nada apuntado en esos días.</p>
	{/if}

	{#if data.money}
		{@const m = data.money}
		<section class={card}>
			<h3 class="mb-1 text-sm text-zinc-400">Dinero, de toda la familia</h3>
			<p class="text-2xl font-semibold tabular-nums">{euros(m.total)}</p>
			<p class="mb-3 text-sm text-zinc-400">
				{m.count === 1 ? '1 gasto' : `${m.count} gastos`}{against(m.total, m.before, 2000, euros)
					? ` · ${against(m.total, m.before, 2000, euros)}`
					: ''}{m.fixed ? ` · y ${euros(m.fixed)} de fijos, aparte` : ''}
			</p>
			{#if m.categories.length}
				<ul class="mb-3 flex flex-col gap-1.5">
					{#each m.categories as c (c.category)}
						<li class="grid grid-cols-[8rem_1fr_auto] items-center gap-2 text-sm">
							<span class="truncate">{c.category}</span>
							<span class="h-2 overflow-hidden rounded-full bg-zinc-800">
								<span
									class="block h-full rounded-full bg-amber-500"
									style:width="{(c.total / largest) * 100}%"
								></span>
							</span>
							<span class="text-right tabular-nums">{euros(c.total)}</span>
						</li>
					{/each}
				</ul>
			{/if}
			{#if m.up.length || m.down.length}
				<p class="text-sm text-zinc-300">
					{#each m.up as c, i (c.category)}{i ? ', ' : 'Más: '}{c.category}
						(+{euros(c.by)}){/each}{m.up.length && m.down.length
						? '. '
						: ''}{#each m.down as c, i (c.category)}{i ? ', ' : 'Menos: '}{c.category} (−{euros(
							-c.by
						)}){/each}.
				</p>
			{/if}
			{#if m.largest.length > 1}
				<p class="mt-2 text-sm text-zinc-400">
					Los mayores:
					{#each m.largest as e, i (e.id)}{i ? ', ' : ''}<a
							href="/gastos?mes={monthOf(e.date)}&gasto={e.id}"
							class="text-amber-400 hover:underline">{e.store}</a
						>
						{euros(e.total)}{/each}.
				</p>
			{/if}
			<a
				href="/gastos/busqueda?desde={p.from}&hasta={p.to}"
				class="mt-2 inline-block text-sm text-amber-400 hover:underline">Verlos todos</a
			>
		</section>
	{/if}

	{#if data.charges.length}
		<section class={card}>
			<h3 class="mb-1 text-sm text-zinc-400">
				{p.view === 'dias'
					? 'Fijos que vienen'
					: p.view === 'semana'
						? 'Fijos que quedan esta semana'
						: 'Fijos que quedan este mes'}
			</h3>
			<p>
				{data.charges.length === 1 ? chargeText(data.charges[0]!) : chargesSummary(data.charges)}
			</p>
			{#if data.charges.length > 1}
				<ul class="mt-2 divide-y divide-zinc-800 text-sm">
					{#each data.charges as c (c.id)}
						<li class="flex gap-3 py-1">
							<span class="min-w-0 flex-1">{inDays(c.left)}, {c.name}</span>
							<span class="tabular-nums">{euros(c.amount)}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

	{#if data.walks}
		{@const w = data.walks}
		<section class={card}>
			<h3 class="mb-1 text-sm text-zinc-400">Tus paseos</h3>
			<p class="text-2xl font-semibold">{walkDistanceText(w.metres)}</p>
			<p class="text-sm text-zinc-400">
				{w.outings === 1 ? '1 salida' : `${w.outings} salidas`} · {durationText(
					w.seconds
				)}{w.kcal !== null ? ` · ${kcalText(w.kcal)}` : ''}{w.before.outings
					? ` · ${against(w.metres, w.before.metres, 2000, walkDistanceText)}`
					: ''}
			</p>
			<a href="/paseos" class="mt-2 inline-block text-sm text-amber-400 hover:underline"
				>Ver en Paseos</a
			>
		</section>
	{/if}

	{#if data.next?.count}
		<section class={card}>
			<h3 class="mb-2 text-sm text-zinc-400">Agenda, los próximos 7 días</h3>
			{@render events(data.next.days, data.next.more)}
		</section>
	{/if}
	{#if data.past.count}
		<section class={card}>
			<h3 class="mb-2 text-sm text-zinc-400">Agenda, lo que hubo</h3>
			{@render events(data.past.days, data.past.more)}
		</section>
	{/if}
</div>
