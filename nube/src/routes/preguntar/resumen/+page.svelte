<script lang="ts">
	import { euros, monthName, monthOf } from 'comun/expenses.ts';
	import { sectionOn } from '#lib/nav.ts';
	import PreguntarTabs from '#lib/components/PreguntarTabs.svelte';
	import { chargesSummary, chargeText, inDays } from '#lib/charges.ts';
	import { daysText } from '#lib/report-days.ts';
	import {
		changeText,
		LEAST_METRES,
		LEAST_MONEY,
		LEAST_WH,
		per100Km,
		SUMMARY_BLOCKS,
		SUMMARY_VIEWS,
		type SummaryBlock,
		type SummaryView
	} from '#lib/summary.ts';
	import { energyText } from '#lib/plugs.ts';
	import { durationText } from '#lib/trips.ts';
	import { kcalText } from '#lib/walk-kcal.ts';
	import { walkDistanceText } from '#lib/walks.ts';
	import type { PageProps } from './$types';

	/** Preguntar → Resumen: figures, beside the period before; only what has something to say. */
	let { data }: PageProps = $props();

	/** Of a section the family, or they, took out: nor here. */
	const shows = (b: SummaryBlock) =>
		sectionOn(SUMMARY_BLOCKS[b].section, data.family?.sections, data.family?.mine);
	const money = $derived(shows('dinero') ? data.money : null);
	const walks = $derived(shows('paseos') ? data.walks : null);
	const charges = $derived(shows('fijos') ? data.charges : []);
	const shopping = $derived(shows('compras') ? data.shopping : null);
	const energy = $derived(shows('energia') ? data.energy : null);
	const car = $derived(shows('coche') ? data.car : null);
	const medication = $derived(shows('medicacion') ? data.medication : []);
	const wishes = $derived(shows('deseos') ? data.wishes : null);
	const past = $derived(shows('agenda') ? data.past : null);
	const next = $derived(shows('agenda') ? data.next : null);
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
	const largest = $derived(Math.max(1, ...(money?.categories ?? []).map((c) => c.total)));
	const empty = $derived(
		!money &&
			!shopping &&
			!energy &&
			!car &&
			!medication.length &&
			!wishes &&
			!walks &&
			!past?.count &&
			!next?.count &&
			!charges.length
	);
	/** «3,2 kWh, 0,80 €»: without a price, only the kWh. */
	const used = (wh: number, cents: number | null) =>
		cents === null ? energyText(wh) : `${energyText(wh)}, ${euros(cents)}`;
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

	{#if money}
		{@const m = money}
		<section class={card}>
			<h3 class="mb-1 text-sm text-zinc-400">Dinero, de toda la familia</h3>
			<p class="text-2xl font-semibold tabular-nums">{euros(m.total)}</p>
			<p class="mb-3 text-sm text-zinc-400">
				{m.count === 1 ? '1 gasto' : `${m.count} gastos`}{against(
					m.total,
					m.before,
					LEAST_MONEY,
					euros
				)
					? ` · ${against(m.total, m.before, LEAST_MONEY, euros)}`
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

	{#if shopping}
		{@const s = shopping}
		<section class={card}>
			<h3 class="mb-2 text-sm text-zinc-400">Compras, por las líneas de los tickets</h3>
			{#if s.repeated.length}
				<p class="mb-1 text-sm text-zinc-300">Lo que más se repite:</p>
				<ul class="mb-3 divide-y divide-zinc-800 text-sm">
					{#each s.repeated as r (r.text)}
						<li class="flex gap-3 py-1">
							<span class="min-w-0 flex-1 truncate">{r.text}</span>
							<span class="shrink-0 text-zinc-400">{r.times} veces</span>
							<span class="w-20 shrink-0 text-right tabular-nums">{euros(r.total)}</span>
						</li>
					{/each}
				</ul>
			{/if}
			{#if s.dearer.length}
				<p class="mb-1 text-sm text-zinc-300">Más caro que la última vez, en la misma tienda:</p>
				<ul class="divide-y divide-zinc-800 text-sm">
					{#each s.dearer as d (d.id + d.text)}
						<li class="flex gap-3 py-1">
							<a
								href="/gastos?mes={monthOf(d.date)}&gasto={d.id}"
								class="min-w-0 flex-1 truncate hover:underline"
								>{d.text} <span class="text-zinc-500">· {d.store}</span></a
							>
							<span class="shrink-0 text-right tabular-nums"
								>{euros(d.was)} → {euros(d.now)}
								<span class="text-red-400">+{d.percent} %</span></span
							>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

	{#if charges.length}
		<section class={card}>
			<h3 class="mb-1 text-sm text-zinc-400">
				{p.view === 'dias'
					? 'Fijos que vienen'
					: p.view === 'semana'
						? 'Fijos que quedan esta semana'
						: 'Fijos que quedan este mes'}
			</h3>
			<p>
				{charges.length === 1 ? chargeText(charges[0]!) : chargesSummary(charges)}
			</p>
			{#if charges.length > 1}
				<ul class="mt-2 divide-y divide-zinc-800 text-sm">
					{#each charges as c (c.id)}
						<li class="flex gap-3 py-1">
							<span class="min-w-0 flex-1">{inDays(c.left)}, {c.name}</span>
							<span class="tabular-nums">{euros(c.amount)}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

	{#if energy}
		{@const en = energy}
		<section class={card}>
			<h3 class="mb-1 text-sm text-zinc-400">Energía, de los enchufes</h3>
			<p class="text-2xl font-semibold tabular-nums">{energyText(en.wh)}</p>
			<p class="text-sm text-zinc-400">
				{[
					en.cents === null ? 'Sin precio del kWh' : euros(en.cents),
					en.before
						? against(en.wh, en.before.wh, LEAST_WH, (wh) => used(wh, en.before!.cents))
						: null
				]
					.filter(Boolean)
					.join(' · ')}
			</p>
			{#if en.plugs.length > 1}
				<p class="mt-2 text-sm text-zinc-300">
					Los que más:
					{#each en.plugs as x, i (x.id)}{i ? ', ' : ''}{x.name} ({used(x.wh, x.cents)}){/each}.
				</p>
			{/if}
			{#if en.noData}
				<p class="mt-2 text-sm text-zinc-500">
					{en.noData === 1 ? '1 hora sin dato' : `${en.noData} horas sin dato`}, que no cuentan.
				</p>
			{/if}
			<a href="/enchufes/consumo" class="mt-2 inline-block text-sm text-amber-400 hover:underline"
				>Ver en Energía</a
			>
		</section>
	{/if}

	{#if car}
		{@const c = car}
		{@const cost = per100Km(c)}
		<section class={card}>
			<h3 class="mb-1 text-sm text-zinc-400">Tu coche</h3>
			<p class="text-2xl font-semibold tabular-nums">{walkDistanceText(c.metres)}</p>
			<p class="text-sm text-zinc-400">
				{[
					c.trips === 1 ? '1 viaje' : `${c.trips} viajes`,
					c.before !== null ? against(c.metres, c.before, LEAST_METRES, walkDistanceText) : null,
					c.fuels ? `gasolina, ${euros(c.fuel)}` : null,
					cost !== null ? `${euros(cost)} cada 100 km` : null
				]
					.filter(Boolean)
					.join(' · ')}
			</p>
			<p class="mt-1 text-xs text-zinc-500">
				Lo que conduces con el modo carretera, y lo que apuntas tú en Gasolina.
			</p>
			<a href="/viajes" class="mt-2 inline-block text-sm text-amber-400 hover:underline"
				>Ver en Viajes</a
			>
		</section>
	{/if}

	{#if medication.length}
		<section class={card}>
			<h3 class="mb-2 text-sm text-zinc-400">Medicación</h3>
			<ul class="flex flex-col gap-3 text-sm">
				{#each medication as m (m.personId)}
					<li>
						<p>
							<span class="font-medium">{m.name}</span>:
							<span class={m.taken === m.due ? 'text-emerald-400' : 'text-zinc-300'}
								>{m.taken} de {m.due} tomas marcadas</span
							>
						</p>
						{#if m.missed.length}
							<p class="text-zinc-400">
								Sin marcar:
								{#each m.missed as d, i (i)}{i ? ', ' : ''}{day(d.day)}
									{d.time}
									{d.name}{/each}{m.more ? ` y ${m.more} más` : ''}.
							</p>
						{/if}
					</li>
				{/each}
			</ul>
			<a href="/agenda/medicacion" class="mt-2 inline-block text-sm text-amber-400 hover:underline"
				>Ver en Medicación</a
			>
		</section>
	{/if}

	{#if wishes}
		{@const d = wishes}
		<section class={card}>
			<h3 class="mb-1 text-sm text-zinc-400">Deseos comprados</h3>
			<p class="text-2xl font-semibold tabular-nums">{euros(d.total)}</p>
			<p class="mb-2 text-sm text-zinc-400">
				{d.count === 1 ? '1 deseo' : `${d.count} deseos`}{d.unknown
					? ` · ${d.unknown === 1 ? '1 sin precio' : `${d.unknown} sin precio`}, no cuentan`
					: ''}
			</p>
			<ul class="divide-y divide-zinc-800 text-sm">
				{#each d.items as w (w.id)}
					<li class="flex gap-3 py-1">
						<span class="min-w-0 flex-1 truncate"
							>{w.title} <span class="text-zinc-500">· {w.person}, {w.shop}</span></span
						>
						<span class="shrink-0 text-right tabular-nums"
							>{w.cents === null ? '' : euros(w.cents)}</span
						>
					</li>
				{/each}
			</ul>
			<a href="/deseos" class="mt-2 inline-block text-sm text-amber-400 hover:underline"
				>Ver en Deseos</a
			>
		</section>
	{/if}

	{#if walks}
		{@const w = walks}
		<section class={card}>
			<h3 class="mb-1 text-sm text-zinc-400">Tus paseos</h3>
			<p class="text-2xl font-semibold">{walkDistanceText(w.metres)}</p>
			<p class="text-sm text-zinc-400">
				{w.outings === 1 ? '1 salida' : `${w.outings} salidas`} · {durationText(
					w.seconds
				)}{w.kcal !== null ? ` · ${kcalText(w.kcal)}` : ''}{w.before.outings
					? ` · ${against(w.metres, w.before.metres, LEAST_METRES, walkDistanceText)}`
					: ''}
			</p>
			<a href="/paseos" class="mt-2 inline-block text-sm text-amber-400 hover:underline"
				>Ver en Paseos</a
			>
		</section>
	{/if}

	{#if next?.count}
		<section class={card}>
			<h3 class="mb-2 text-sm text-zinc-400">Agenda, los próximos 7 días</h3>
			{@render events(next.days, next.more)}
		</section>
	{/if}
	{#if past?.count}
		<section class={card}>
			<h3 class="mb-2 text-sm text-zinc-400">Agenda, lo que hubo</h3>
			{@render events(past.days, past.more)}
		</section>
	{/if}
	<p class="text-sm text-zinc-500">
		Qué sale aquí, y la tarjeta de la portada, en
		<a href="/ajustes?seccion=mi#resumen" class="text-amber-400 hover:underline">Ajustes</a>.
	</p>
</div>
