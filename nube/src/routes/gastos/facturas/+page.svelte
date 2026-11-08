<script lang="ts">
	import ExpenseTabs from '#lib/components/ExpenseTabs.svelte';
	import { POWER_MARGIN } from 'comun/bill-analysis.ts';
	import { billDays } from 'comun/bills.ts';
	import { euros, monthName } from 'comun/expenses.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** The month said over the bars: the latest with a bill, until another is touched. */
	let picked = $state<string | null>(null);
	const shown = $derived(
		data.months.find((m) => m.month === picked) ??
			data.months.findLast((m) => m.now !== null) ??
			data.months[data.months.length - 1]!
	);
	const highest = $derived(Math.max(...data.months.flatMap((m) => [m.now ?? 0, m.before ?? 0]), 1));
	const hasBefore = $derived(data.months.some((m) => m.before !== null));

	const amount = (value: number) =>
		`${value.toLocaleString('es-ES', { maximumFractionDigits: 1 })} ${data.unit}`;

	/** The change on the year before, «+12 %». */
	const change = (now: number, before: number) => {
		const pct = Math.round(((now - before) / before) * 100);
		return `${pct > 0 ? '+' : ''}${pct} %`;
	};

	/** Each bill's numbers (bill-analysis.ts), by its id. */
	const analysisOf = $derived(new Map(data.analysis.map((a) => [a.id, a])));
	const latest = $derived(data.bills[0]);
	const latestAnalysis = $derived(latest && analysisOf.get(latest.id));
	const billOf = (id: number) => data.bills.find((b) => b.id === id);

	/** «+12 %», «−5 %». */
	const pct = (change: number) => {
		const n = Math.round(change * 100);
		return `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}\u00a0%`;
	};
	/** Dearer, amber; cheaper, green. */
	const tone = (change: number) =>
		Math.round(change * 100) > 0
			? 'text-amber-400'
			: Math.round(change * 100) < 0
				? 'text-green-400'
				: 'text-zinc-400';
	/** A price per unit, to the tenth of a cent: «0,214 €/kWh». */
	const perUnit = (cents: number) =>
		`${(cents / 100).toLocaleString('es-ES', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} €/${data.unit}`;
	const kw = (value: number) =>
		`${value.toLocaleString('es-ES', { maximumFractionDigits: 2 })}\u00a0kW`;
	const perDayUnits = (units: number) =>
		`${units.toLocaleString('es-ES', { maximumFractionDigits: 1 })} ${data.unit}`;

	const shortMonth = (month: string) =>
		new Date(`${month}-15T12:00:00Z`).toLocaleDateString('es-ES', {
			month: 'short',
			timeZone: 'UTC'
		});

	const shortDay = (day: string) =>
		new Date(`${day}T12:00:00Z`).toLocaleDateString('es-ES', {
			day: 'numeric',
			month: 'short',
			year: '2-digit',
			timeZone: 'UTC'
		});

	const chip = (on: boolean) => [
		'rounded-full px-3 py-1 text-sm',
		on ? 'bg-amber-500 font-semibold text-zinc-950' : 'bg-zinc-800 hover:bg-zinc-700'
	];
</script>

<svelte:head>
	<title>Facturas · Seilide</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<h1 class="mb-3 text-2xl font-bold">Dinero</h1>
	<ExpenseTabs current="facturas" />

	{#if data.kinds.length > 1}
		<div class="mb-6 flex flex-wrap gap-2">
			{#each data.kinds as k (k)}
				<a href="?de={k}" class={chip(data.kind === k)}>{k}</a>
			{/each}
		</div>
	{/if}

	{#if !data.bills.length}
		<p class="mb-4 text-zinc-400">
			Aún no hay facturas de {data.kind.toLowerCase()}. En el mes, «📄 Factura» con su PDF; desde el
			móvil, también «Compartir → JellyCartoon» desde la app de la compañía.
		</p>
	{:else}
		<!-- What to look at (bill-analysis.ts): a bill that does not add up, a much dearer one. -->
		{#if data.warnings.length}
			<ul class="mb-6 flex flex-col gap-2">
				{#each data.warnings as w (`${w.kind}-${w.id}`)}
					{@const b = billOf(w.id)}
					<li
						class="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
					>
						<span aria-hidden="true">⚠️</span>
						<span class="min-w-0 flex-1">
							{#if w.kind === 'no-cuadra'}
								La factura del {b ? `${shortDay(b.periodStart)} – ${shortDay(b.periodEnd)}` : ''} no cuadra:
								sus partes suman {euros(w.partsSum)} y el total es {euros(w.total)}. Compárala con
								el PDF.
							{:else}
								La última factura sale a {euros(Math.round(latestAnalysis?.centsPerDay ?? 0))} al día:
								un {Math.round(w.change * 100)}&nbsp;% más que las mismas fechas del año pasado.
							{/if}
						</span>
						<a
							href="/gastos/ticket/{w.id}"
							target="_blank"
							class="shrink-0 text-amber-400 hover:underline">Ver</a
						>
					</li>
				{/each}
			</ul>
		{/if}

		<!-- The latest bill, by the day (bills cover different days) and its real price. -->
		{#if latest && latestAnalysis}
			{@const c = latestAnalysis.change}
			<section class="mb-8 grid gap-3 sm:grid-cols-2">
				<div class="rounded-lg bg-zinc-900 p-4">
					<h2 class="text-sm text-zinc-400">Cada día, en la última factura</h2>
					<p class="mt-1 text-2xl font-semibold tabular-nums">
						{euros(Math.round(latestAnalysis.centsPerDay))}
						{#if latestAnalysis.unitsPerDay !== null}
							<span class="text-base font-normal text-zinc-400"
								>· {perDayUnits(latestAnalysis.unitsPerDay)}</span
							>
						{/if}
					</p>
					<p class="mt-1 text-sm text-zinc-400">
						{#if c?.perDay != null}
							<span class={tone(c.perDay)}>{pct(c.perDay)}</span> que las mismas fechas del año
							pasado{#if c.unitsPerDay != null}; consumo, <span class={tone(c.unitsPerDay)}
									>{pct(c.unitsPerDay)}</span
								>{/if}.
						{:else}
							Sin factura de las mismas fechas del año pasado para comparar.
						{/if}
					</p>
				</div>
				{#if latestAnalysis.centsPerUnit !== null}
					<div class="rounded-lg bg-zinc-900 p-4">
						<h2 class="text-sm text-zinc-400">Precio real</h2>
						<p class="mt-1 text-2xl font-semibold tabular-nums">
							{perUnit(latestAnalysis.centsPerUnit)}
						</p>
						<p class="mt-1 text-sm text-zinc-400">
							Todo lo pagado entre lo consumido.
							{#if c?.perUnit != null}
								<span class={tone(c.perUnit)}>{pct(c.perUnit)}</span> que hace un año.
							{/if}
						</p>
						{#if data.kind !== 'Agua'}
							<a
								href="https://comparador.cnmc.gob.es"
								target="_blank"
								rel="noreferrer"
								class="mt-2 inline-block text-sm text-amber-400 hover:underline"
								>¿Hay algo mejor? Comparador de la CNMC ↗</a
							>
						{/if}
					</div>
				{/if}
			</section>
		{/if}

		{#if data.kind === 'Luz'}
			<a
				href="/gastos/facturas/simular"
				class="mb-8 block rounded-lg bg-zinc-900 p-4 text-sm hover:bg-zinc-800"
				><span class="font-semibold">¿Y si…?</span>
				<span class="block text-zinc-400"
					>Cuánto habrías pagado con otra tarifa, con tus facturas.</span
				></a
			>
		{/if}

		<!-- Is too much power contracted? (bill-analysis.ts, powerAnalysis) -->
		{#if data.power}
			{@const pw = data.power}
			<section class="mb-8 rounded-lg bg-zinc-900 p-4">
				<h2 class="text-sm text-zinc-400">Potencia contratada</h2>
				<ul class="mt-1 text-sm">
					{#each pw.periods as x (x.name)}
						<li>
							<span class="text-zinc-400">{x.name}:</span>
							<span class="font-semibold tabular-nums">{kw(x.contracted)}</span>
							contratados · la más alta en un año, <span class="tabular-nums">{kw(x.used)}</span>
						</li>
					{/each}
				</ul>
				{#if pw.spare}
					<p class="mt-2 text-sm">
						Os sobra potencia: con {pw.periods
							.map((x) =>
								pw.periods.length > 1 ? `${kw(x.proposed)} en ${x.name}` : kw(x.proposed)
							)
							.join(' y ')}
						(la más alta y un {Math.round(POWER_MARGIN * 100)}&nbsp;% de margen) os bastaría{#if pw.savingPerYear !== null},
							y ahorraríais unos <span class="font-semibold text-green-400"
								>{pw.savingPerYear}&nbsp;€ al año</span
							> más impuestos{/if}.
					</p>
					{#if pw.savingPerYear === null}
						<p class="mt-1 text-xs text-zinc-500">
							Cuánto ahorraríais, con la próxima factura que se lea: las de antes no traen el precio
							de la potencia.
						</p>
					{/if}
					<p class="mt-1 text-xs text-zinc-500">
						Antes de bajarla, pregunta a tu compañía cuánto cuesta el cambio, y piensa si vais a
						enchufar algo grande (un coche eléctrico, una placa de inducción nueva).
					</p>
				{:else}
					<p class="mt-2 text-sm text-zinc-400">Va justa para lo que usáis: bien así.</p>
				{/if}
			</section>
		{/if}

		<section class="mb-8 rounded-lg bg-zinc-900 p-4">
			<h2 class="mb-1 font-semibold">Consumo de cada mes</h2>
			<p class="mb-3 text-sm text-zinc-400">
				<span class="first-letter:uppercase">{monthName(shown.month)}</span>:
				{#if shown.now !== null}
					<span class="font-semibold text-white tabular-nums">{amount(shown.now)}</span>
				{:else}
					sin factura
				{/if}
				{#if shown.before !== null}
					· hace un año, {amount(shown.before)}
					{#if shown.now !== null && shown.before > 0}({change(shown.now, shown.before)}){/if}
				{/if}
			</p>
			<div class="flex h-40 items-end gap-1">
				{#each data.months as m (m.month)}
					<button
						class="flex h-full flex-1 items-end justify-center gap-0.5"
						aria-label="{monthName(m.month)}: {m.now === null ? 'sin factura' : amount(m.now)}"
						aria-pressed={m.month === shown.month}
						onclick={() => (picked = m.month)}
					>
						{#if hasBefore}
							<span
								class="block w-1/3 rounded-t bg-zinc-600"
								style:height="{((m.before ?? 0) / highest) * 100}%"
							></span>
						{/if}
						<span
							class={[
								'block rounded-t bg-amber-500',
								hasBefore ? 'w-1/2' : 'w-full',
								m.month === shown.month && 'ring-2 ring-white'
							]}
							style:height="{((m.now ?? 0) / highest) * 100}%"
						></span>
					</button>
				{/each}
			</div>
			<div class="mt-1 flex gap-1 text-center text-[0.65rem] text-zinc-500">
				{#each data.months as m (m.month)}
					<span class="flex-1 truncate">{shortMonth(m.month)}</span>
				{/each}
			</div>
			{#if hasBefore}
				<p class="mt-2 flex gap-4 text-xs text-zinc-400">
					<span
						><span class="mr-1 inline-block size-2.5 rounded-sm bg-amber-500"></span>Este año</span
					>
					<span
						><span class="mr-1 inline-block size-2.5 rounded-sm bg-zinc-600"></span>Un año antes</span
					>
				</p>
			{/if}
		</section>

		<section class="mb-10">
			<h2 class="mb-1 font-semibold">Facturas</h2>
			<p class="mb-3 text-sm text-zinc-400">
				Cada una por día, y su precio con todo: lo pagado entre lo consumido, con potencia,
				impuestos y descuentos. Junto, lo que cambia frente a las mismas fechas del año pasado.
			</p>
			<ul class="divide-y divide-zinc-800">
				{#each data.bills as b (b.id)}
					{@const a = analysisOf.get(b.id)}
					<li class="flex items-center gap-3 py-2">
						<span class="min-w-0 flex-1">
							<span class="block truncate"
								>{shortDay(b.periodStart)} – {shortDay(b.periodEnd)}
								<span class="text-zinc-500">· {billDays(b)} días</span></span
							>
							<span class="block truncate text-xs text-zinc-500"
								>{b.store}{#if b.consumption}{' '}· {amount(b.consumption)} · {perUnit(
										b.total / b.consumption
									)} con todo{/if}</span
							>
						</span>
						<span class="shrink-0 text-right tabular-nums">
							{euros(b.total)}
							{#if a}
								<span class="block text-xs text-zinc-500"
									>{euros(Math.round(a.centsPerDay))}/día{#if a.change?.perDay != null}
										· <span class={tone(a.change.perDay)}>{pct(a.change.perDay)}</span>{/if}</span
								>
							{/if}
						</span>
						<a
							href="/gastos/ticket/{b.id}"
							target="_blank"
							class="rounded-md px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white"
							aria-label="Ver la factura">📄</a
						>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>
