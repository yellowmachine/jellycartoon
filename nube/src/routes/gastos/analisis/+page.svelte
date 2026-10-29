<script lang="ts">
	import { page } from '$app/state';
	import ExpenseTabs from '#lib/components/ExpenseTabs.svelte';
	import { euros, monthName, type ExpenseCategory } from 'comun/expenses.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** The month whose total is said over the bars: this one, until another is touched. */
	let picked = $state<string | null>(null);
	const shown = $derived(
		data.months.find((m) => m.month === picked) ?? data.months[data.months.length - 1]!
	);
	const highest = $derived(Math.max(...data.months.map((m) => m.total), data.average ?? 0, 1));
	/** The category open, with its tags. */
	let open = $state<ExpenseCategory | null>(null);
	const largest = $derived(data.categories[0]?.total ?? 0);

	/** This page with one of its choices changed. */
	function withParam(name: string, value: string | null) {
		const url = new URL(page.url.href);
		if (value === null) url.searchParams.delete(name);
		else url.searchParams.set(name, value);
		return `${url.pathname}${url.search}`;
	}

	const shortMonth = (month: string) =>
		new Date(`${month}-15T12:00:00Z`).toLocaleDateString('es-ES', {
			month: 'short',
			timeZone: 'UTC'
		});

	const chip = (on: boolean) => [
		'rounded-full px-3 py-1 text-sm',
		on ? 'bg-amber-500 font-semibold text-zinc-950' : 'bg-zinc-800 hover:bg-zinc-700'
	];
</script>

<svelte:head>
	<title>Análisis de gastos · Seilide</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<h1 class="mb-3 text-2xl font-bold">Gastos</h1>
	<ExpenseTabs current="analisis" />

	<div class="mb-6 flex flex-wrap items-center gap-2">
		{#each data.periods as p (p)}
			<a href={withParam('meses', p === 6 ? null : String(p))} class={chip(data.period === p)}
				>{p} meses</a
			>
		{/each}
		<span class="mx-1 h-5 w-px bg-zinc-700"></span>
		<a href={withParam('fijos', data.withFixed ? 'no' : null)} class={chip(!data.withFixed)}
			>Sin fijos</a
		>
	</div>

	<section class="mb-8 rounded-lg bg-zinc-900 p-4">
		<h2 class="mb-1 font-semibold">Últimos 12 meses</h2>
		<p class="mb-3 text-sm text-zinc-400">
			<span class="first-letter:uppercase">{monthName(shown.month)}</span>:
			<span class="font-semibold text-white tabular-nums">{euros(shown.total)}</span>
			{#if shown.month === data.current}(va por aquí){/if}
			{#if data.average !== null}· media de un mes, {euros(data.average)}{/if}
		</p>
		<div class="relative flex h-40 items-end gap-1">
			{#if data.average !== null}
				<div
					class="pointer-events-none absolute inset-x-0 border-t border-dashed border-zinc-400"
					style:bottom="{(data.average / highest) * 100}%"
				></div>
			{/if}
			{#each data.months as m (m.month)}
				<button
					class="flex h-full flex-1 items-end"
					aria-label="{monthName(m.month)}: {euros(m.total)}"
					aria-pressed={m.month === shown.month}
					onclick={() => (picked = m.month)}
				>
					<span
						class={[
							'block w-full rounded-t',
							m.month === data.current ? 'bg-amber-500/50' : 'bg-amber-500',
							m.month === shown.month && 'ring-2 ring-white'
						]}
						style:height="{(m.total / highest) * 100}%"
					></span>
				</button>
			{/each}
		</div>
		<div class="mt-1 flex gap-1 text-center text-[0.65rem] text-zinc-500">
			{#each data.months as m (m.month)}
				<span class="flex-1 truncate">{shortMonth(m.month)}</span>
			{/each}
		</div>
	</section>

	<section class="mb-8">
		<h2 class="mb-1 font-semibold">Este mes, por encima de lo normal</h2>
		<p class="mb-3 text-sm text-zinc-400">
			Lo que ya pasa de lo que suele, comparado con la media de los tres meses anteriores.
		</p>
		{#if data.above === null}
			<p class="text-sm text-zinc-400">
				Para comparar hace falta al menos un mes entero apuntado. Vuelve el mes que viene.
			</p>
		{:else}
			<ul class="divide-y divide-zinc-800">
				{#each data.above as a (`${a.category}\n${a.tag}`)}
					<li class="flex items-center gap-3 py-2">
						<span class="min-w-0 flex-1">
							<span class="block truncate">{a.tag ?? a.category}</span>
							<span class="block text-xs text-zinc-500"
								>{a.tag ? `en ${a.category} · ` : ''}normalmente {euros(a.usual)}</span
							>
						</span>
						<span class="text-right tabular-nums">
							<span class="block">{euros(a.now)}</span>
							<span class="block text-xs text-amber-300">▲ {euros(a.now - a.usual)}</span>
						</span>
					</li>
				{:else}
					<li class="py-2 text-sm text-zinc-400">Nada por encima de lo normal este mes.</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="mb-8">
		<h2 class="mb-1 font-semibold">En qué se va</h2>
		<p class="mb-3 text-sm text-zinc-400">
			{data.periodMonths === 1 ? 'Este mes' : `Los últimos ${data.periodMonths} meses`}, con lo que
			sale de media al mes. Toca una categoría con ▸ para verla por etiquetas.
		</p>
		<ul class="flex flex-col gap-1.5">
			{#each data.categories as c (c.category)}
				<li>
					<svelte:element
						this={c.tags.length ? 'button' : 'div'}
						class="grid w-full grid-cols-[8rem_1fr_auto] items-center gap-2 text-left text-sm"
						aria-expanded={c.tags.length ? open === c.category : undefined}
						onclick={c.tags.length
							? () => (open = open === c.category ? null : c.category)
							: undefined}
						role={c.tags.length ? undefined : 'presentation'}
					>
						<span class="truncate"
							>{c.category}{#if c.tags.length}<span class="text-zinc-500">
									{open === c.category ? '▾' : '▸'}</span
								>{/if}</span
						>
						<span class="h-2 overflow-hidden rounded-full bg-zinc-800">
							<span
								class="block h-full rounded-full bg-amber-500"
								style:width="{(c.total / largest) * 100}%"
							></span>
						</span>
						<span class="text-right tabular-nums">
							{euros(c.total)}
							{#if data.periodMonths > 1}<span class="block text-xs text-zinc-500"
									>{euros(c.perMonth)}/mes</span
								>{/if}
						</span>
					</svelte:element>
					{#if open === c.category}
						<ul class="mt-1 mb-2 flex flex-col gap-1 pl-3">
							{#each c.tags as t (t.tag)}
								<li
									class="grid grid-cols-[7.25rem_1fr_auto] items-center gap-2 text-xs text-zinc-300"
								>
									<span class="truncate">{t.tag}</span>
									<span class="h-1.5 overflow-hidden rounded-full bg-zinc-800">
										<span
											class="block h-full rounded-full bg-amber-500/60"
											style:width="{(Math.max(t.total, 0) / c.total) * 100}%"
										></span>
									</span>
									<span class="text-right tabular-nums">{euros(t.total)}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</li>
			{:else}
				<li class="text-sm text-zinc-400">Nada apuntado en estos meses.</li>
			{/each}
		</ul>
	</section>

	<section class="mb-10">
		<h2 class="mb-1 font-semibold">Dónde compráis</h2>
		<p class="mb-3 text-sm text-zinc-400">
			Las tiendas de los tickets y de lo apuntado a mano, en el mismo periodo.
		</p>
		<ul class="divide-y divide-zinc-800">
			{#each data.stores as s (s.store)}
				<li class="flex items-center gap-3 py-2">
					<span class="min-w-0 flex-1">
						<span class="block truncate">{s.store}</span>
						<span class="block text-xs text-zinc-500"
							>{s.visits === 1 ? 'una vez' : `${s.visits} veces`} · {euros(
								Math.round(s.total / s.visits)
							)} de media</span
						>
					</span>
					<span class="tabular-nums">{euros(s.total)}</span>
				</li>
			{:else}
				<li class="py-2 text-sm text-zinc-400">Ninguna tienda en estos meses.</li>
			{/each}
		</ul>
	</section>
</div>
