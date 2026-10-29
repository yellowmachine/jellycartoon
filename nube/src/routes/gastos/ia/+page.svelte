<script lang="ts">
	import ExpenseTabs from '#lib/components/ExpenseTabs.svelte';
	import { cost, dollars } from 'comun/ai-spend.ts';
	import { dayName } from 'comun/agenda.ts';
	import { monthName } from 'comun/expenses.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** «Por tipo»: this month's, or all of it. */
	let span = $state<'month' | 'all'>('month');
	const kinds = $derived(data.kinds[span]);
	const largest = $derived(kinds[0]?.cost ?? 0);

	const highestMonth = $derived(Math.max(...data.months.map((m) => m.cost), 0.0001));
	const highestWeek = $derived(Math.max(...data.weeks.map((w) => w.cost), 0.0001));

	const shortMonth = (month: string) =>
		new Date(`${month}-15T12:00:00Z`).toLocaleDateString('es-ES', {
			month: 'short',
			timeZone: 'UTC'
		});
	/** «27 oct»: a week by its Monday. */
	const shortDay = (day: string) =>
		new Date(`${day}T12:00:00Z`).toLocaleDateString('es-ES', {
			day: 'numeric',
			month: 'short',
			timeZone: 'UTC'
		});
	const when = (at: string) => {
		const date = new Date(at);
		const time = date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
		return `${date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}, ${time}`;
	};

	const chip = (on: boolean) => [
		'rounded-full px-3 py-1 text-sm',
		on ? 'bg-amber-500 font-semibold text-zinc-950' : 'bg-zinc-800 hover:bg-zinc-700'
	];
</script>

<svelte:head>
	<title>Gasto en IA · Nube</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<h1 class="mb-3 text-2xl font-bold">Gastos</h1>
	<ExpenseTabs current="ia" />
	<p class="mb-4 text-sm text-zinc-400">
		Lo que cuesta la inteligencia artificial de la familia, la de la nube y la de casa, en dólares,
		como lo cobra OpenRouter.
		{#if data.since}Apuntado desde el {dayName(data.since.slice(0, 10), true)}.{/if}
	</p>

	<div class="mb-8 grid grid-cols-3 gap-2">
		{#each [{ label: 'Esta semana', value: data.week }, { label: 'Este mes', value: data.month }, { label: 'Todo', value: data.total }] as s (s.label)}
			<div class="rounded-lg bg-zinc-900 p-3">
				<p class="text-xs text-zinc-400">{s.label}</p>
				<p class="text-lg font-semibold text-white tabular-nums">{dollars(s.value)}</p>
			</div>
		{/each}
	</div>
	{#if data.openRouter}
		<p class="-mt-6 mb-8 text-xs text-zinc-500">
			Según OpenRouter, la clave lleva {dollars(data.openRouter.week)} esta semana,
			{dollars(data.openRouter.month)} este mes y {dollars(data.openRouter.total)} en total (sus semanas
			y meses van en hora UTC, y cuenta todo lo que use la clave, también antes de apuntarse aquí).
		</p>
	{/if}

	{#if !data.count}
		<p class="rounded-lg bg-zinc-900 p-4 text-sm text-zinc-400">
			Aún no hay nada apuntado. Cada vez que la IA haga algo (leer un ticket, contestar por voz, la
			sinopsis de una película en casa…) saldrá aquí lo que ha costado.
		</p>
	{:else}
		<section class="mb-8">
			<div class="mb-3 flex flex-wrap items-center gap-2">
				<h2 class="mr-2 font-semibold">Por tipo</h2>
				<button class={chip(span === 'month')} onclick={() => (span = 'month')}>Este mes</button>
				<button class={chip(span === 'all')} onclick={() => (span = 'all')}>Todo</button>
			</div>
			<ul class="flex flex-col gap-1.5">
				{#each kinds as k (k.kind)}
					<li class="rounded-md bg-zinc-900 px-3 py-2">
						<div class="flex items-baseline gap-3">
							<span class="min-w-0 flex-1 truncate">{k.kind}</span>
							<span class="text-xs text-zinc-500 tabular-nums"
								>{k.count}
								{k.count === 1 ? 'vez' : 'veces'} · {cost(k.cost / k.count)} cada una</span
							>
							<span class="w-20 text-right font-semibold tabular-nums">{cost(k.cost)}</span>
						</div>
						<div class="mt-1.5 h-1.5 rounded-full bg-zinc-800">
							<div
								class="h-full rounded-full bg-amber-500"
								style:width="{largest ? (k.cost / largest) * 100 : 0}%"
							></div>
						</div>
					</li>
				{:else}
					<li class="text-sm text-zinc-400">Nada este mes.</li>
				{/each}
			</ul>
		</section>

		<section class="mb-8 rounded-lg bg-zinc-900 p-4">
			<h2 class="mb-3 font-semibold">Por mes</h2>
			<div class="flex h-32 items-end gap-1">
				{#each data.months as m, i (m.month)}
					<div
						class="flex h-full flex-1 items-end"
						title="{monthName(m.month)}: {cost(m.cost)}"
						aria-label="{monthName(m.month)}: {cost(m.cost)}"
					>
						<span
							class={[
								'block w-full rounded-t',
								i === data.months.length - 1 ? 'bg-amber-500/50' : 'bg-amber-500'
							]}
							style:height="{(m.cost / highestMonth) * 100}%"
						></span>
					</div>
				{/each}
			</div>
			<div class="mt-1 flex gap-1 text-center text-[0.65rem] text-zinc-500">
				{#each data.months as m (m.month)}
					<span class="flex-1 truncate">{shortMonth(m.month)}</span>
				{/each}
			</div>
		</section>

		<section class="mb-8 rounded-lg bg-zinc-900 p-4">
			<h2 class="mb-3 font-semibold">Por semana</h2>
			<ul class="flex flex-col gap-1">
				{#each [...data.weeks].reverse() as w, i (w.week)}
					<li class="flex items-center gap-3 text-sm">
						<span class="w-24 shrink-0 text-zinc-400"
							>{i === 0 ? 'Esta' : `${shortDay(w.week)}`}</span
						>
						<span class="h-2 flex-1 rounded-full bg-zinc-800">
							<span
								class="block h-full rounded-full bg-amber-500"
								style:width="{(w.cost / highestWeek) * 100}%"
							></span>
						</span>
						<span class="w-20 text-right tabular-nums">{cost(w.cost)}</span>
					</li>
				{/each}
			</ul>
		</section>

		<section class="mb-10">
			<h2 class="mb-3 font-semibold">Las últimas</h2>
			<ul class="divide-y divide-zinc-800">
				{#each data.recent as r (r.at + r.label)}
					<li class="flex items-center gap-3 py-2">
						<span class="min-w-0 flex-1">
							<span class="block truncate">{r.label}</span>
							<span class="block text-xs text-zinc-500"
								>{when(r.at)} · {r.kind} · {r.app === 'casa' ? 'en casa' : 'en la nube'}</span
							>
						</span>
						<span class="text-right tabular-nums">{cost(r.cost)}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>
