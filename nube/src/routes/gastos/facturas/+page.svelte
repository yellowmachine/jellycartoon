<script lang="ts">
	import ExpenseTabs from '#lib/components/ExpenseTabs.svelte';
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
	<title>Facturas · Nube</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<h1 class="mb-3 text-2xl font-bold">Gastos</h1>
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
			Aún no hay facturas de {data.kind.toLowerCase()}. En el mes, «📄 Factura» con su PDF o una
			foto; desde el móvil, también «Compartir → JellyCartoon» desde la app de la compañía.
		</p>
	{:else}
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
				El precio con todo: lo pagado entre lo consumido, con potencia, impuestos y descuentos.
			</p>
			<ul class="divide-y divide-zinc-800">
				{#each data.bills as b (b.id)}
					<li class="flex items-center gap-3 py-2">
						<span class="min-w-0 flex-1">
							<span class="block truncate"
								>{shortDay(b.periodStart)} – {shortDay(b.periodEnd)}
								<span class="text-zinc-500">· {billDays(b)} días</span></span
							>
							<span class="block truncate text-xs text-zinc-500"
								>{b.store}{#if b.consumption}
									· {amount(b.consumption)} · {euros(Math.round(b.total / b.consumption))}/{b.unit}
									con todo{/if}</span
							>
						</span>
						<span class="shrink-0 tabular-nums">{euros(b.total)}</span>
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
