<script lang="ts">
	import { euros, monthOf, type Expense } from 'comun/expenses.ts';
	import ExpenseTabs from '#lib/components/ExpenseTabs.svelte';
	import type { PageProps } from './$types';

	/** Gastos → Búsqueda: by words and dates; each one, corrected in its month. */
	let { data }: PageProps = $props();

	let open = $state<number | null>(null);
	const total = $derived(data.expenses.reduce((sum, e) => sum + e.total, 0));

	const dayText = (day: string) =>
		new Date(`${day}T12:00:00Z`).toLocaleDateString('es-ES', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			timeZone: 'UTC'
		});

	const SOURCES: Record<Expense['source'], string> = {
		ticket: '📷',
		factura: '📄',
		voz: '🎙',
		mano: '✍',
		fijo: '🔁'
	};

	const field =
		'rounded-md border-zinc-700 bg-zinc-950 py-1.5 text-sm focus:border-amber-500 focus:ring-amber-500';
	const button = 'rounded-md px-3 py-1.5 text-sm';
</script>

<svelte:head>
	<title>Búsqueda · Gastos · Seilide</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<h1 class="mb-3 text-2xl font-bold">Gastos</h1>
	<ExpenseTabs current="busqueda" />

	<form method="get" class="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
		<label class="col-span-2 flex flex-col gap-1 text-xs text-zinc-400 sm:col-span-1">
			Texto
			<input
				type="search"
				name="q"
				value={data.text}
				placeholder="Tienda o algo comprado: «tuio», «leche»…"
				class={field}
			/>
		</label>
		<label class="flex flex-col gap-1 text-xs text-zinc-400">
			Desde
			<input type="date" name="desde" value={data.from ?? ''} class={field} />
		</label>
		<label class="flex flex-col gap-1 text-xs text-zinc-400">
			Hasta
			<input type="date" name="hasta" value={data.to ?? ''} class={field} />
		</label>
		<button
			class="{button} col-span-2 self-end bg-amber-600 font-semibold text-white hover:bg-amber-500 sm:col-span-1"
			>Buscar</button
		>
	</form>

	{#if data.asked}
		<p class="mb-2 text-sm text-zinc-400">
			{#if data.expenses.length}
				{data.expenses.length}
				{data.expenses.length === 1 ? 'gasto' : 'gastos'}:
				<span class="font-semibold text-white tabular-nums">{euros(total)}</span>
				{#if data.expenses.length === data.limit}
					· solo los {data.limit} más recientes: afina la búsqueda para ver los demás{/if}
			{:else}
				Ningún gasto con eso.
			{/if}
		</p>

		<ul class="mb-10 divide-y divide-zinc-800">
			{#each data.expenses as e (e.id)}
				<li>
					<button
						class="flex w-full items-center gap-3 py-2 text-left hover:bg-zinc-900"
						aria-expanded={open === e.id}
						onclick={() => (open = open === e.id ? null : e.id)}
					>
						<span class="w-24 shrink-0 text-sm text-zinc-400">{dayText(e.date)}</span>
						<span class="min-w-0 flex-1">
							<span class="block truncate">{e.store}</span>
							<span class="block truncate text-xs text-zinc-500"
								>{SOURCES[e.source]}
								{e.category}{e.by ? ` · ${e.by}` : ''}{e.lines.length
									? ` · ${e.lines.length} líneas`
									: ''}</span
							>
						</span>
						<span class="shrink-0 tabular-nums">{euros(e.total)}</span>
					</button>
					{#if open === e.id}
						<div class="mb-3 rounded-md bg-zinc-900 p-3 text-sm">
							{#if e.lines.length}
								<ul class="mb-2">
									{#each e.lines as line, i (i)}
										<li class="flex justify-between gap-3">
											<span class="min-w-0 truncate text-zinc-300"
												>{line.text} <span class="text-xs text-zinc-500">· {line.tag}</span></span
											>
											<span class="shrink-0 tabular-nums">{euros(line.amount)}</span>
										</li>
									{/each}
								</ul>
							{/if}
							<div class="flex flex-wrap gap-2">
								{#if e.hasReceipt}
									<a
										href="/gastos/ticket/{e.id}"
										target="_blank"
										class="{button} bg-zinc-800 hover:bg-zinc-700"
										>{e.bill ? 'Ver factura' : 'Ver ticket'}</a
									>
								{/if}
								<!-- Corrected or deleted where it is, in its month. -->
								<a
									href="/gastos?mes={monthOf(e.date)}&gasto={e.id}"
									class="{button} bg-zinc-800 hover:bg-zinc-700">Ver en su mes</a
								>
							</div>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-sm text-zinc-400">
			Busca por lo que pone en la tienda o en las líneas del ticket, entre dos fechas, o las dos
			cosas.
		</p>
	{/if}
</div>
