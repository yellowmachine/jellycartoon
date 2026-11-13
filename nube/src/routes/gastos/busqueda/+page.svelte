<script lang="ts">
	import { euros, monthOf, ownTagOf, type Expense } from 'comun/expenses.ts';
	import ExpenseTabs from '#lib/components/ExpenseTabs.svelte';
	import type { PageProps } from './$types';

	/**
	 * Gastos → Búsqueda: by words, dates and an own tag (#459); each one, corrected in its month. By a
	 * tag, what counts is only its lines.
	 */
	let { data }: PageProps = $props();

	let open = $state<number | null>(null);

	// The filters as written, before «Buscar», for «Descargar hoja».
	let q = $derived(data.text);
	let from = $derived(data.from ?? '');
	let to = $derived(data.to ?? '');
	let tagId = $derived(data.tag ? String(data.tag.id) : '');
	/** The same search as a spreadsheet: every one, and with no filter, the whole history. */
	const sheet = $derived(
		`/gastos/busqueda/hoja?${new URLSearchParams(
			Object.entries({ q: q.trim(), desde: from, hasta: to, etiqueta: tagId }).filter(([, v]) => v)
		)}`
	);
	const total = $derived(data.expenses.reduce((sum, e) => sum + e.total, 0));
	/** Each expense's lines of the tag asked for, by its id. */
	const tagged = $derived(
		new Map(
			data.expenses.map((e) => [
				e.id,
				data.tag ? e.lines.filter((l) => ownTagOf(data.own, l.text)?.id === data.tag!.id) : []
			])
		)
	);
	const taggedLines = $derived([...tagged.values()].flat());
	const taggedTotal = $derived(taggedLines.reduce((sum, l) => sum + l.amount, 0));

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
	<title>Búsqueda · Dinero · Seilide</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<h1 class="mb-3 text-2xl font-bold">Dinero</h1>
	<ExpenseTabs current="busqueda" />

	<form
		method="get"
		class="mb-6 grid grid-cols-2 gap-2 {data.own.tags.length
			? 'sm:grid-cols-[1fr_auto_auto_auto_auto]'
			: 'sm:grid-cols-[1fr_auto_auto_auto]'}"
	>
		<label class="col-span-2 flex flex-col gap-1 text-xs text-zinc-400 sm:col-span-1">
			Texto
			<input
				type="search"
				name="q"
				bind:value={q}
				placeholder="Tienda o algo comprado: «tuio», «leche»…"
				class={field}
			/>
		</label>
		<label class="flex flex-col gap-1 text-xs text-zinc-400">
			Desde
			<input type="date" name="desde" bind:value={from} class={field} />
		</label>
		<label class="flex flex-col gap-1 text-xs text-zinc-400">
			Hasta
			<input type="date" name="hasta" bind:value={to} class={field} />
		</label>
		{#if data.own.tags.length}
			<label class="col-span-2 flex flex-col gap-1 text-xs text-zinc-400 sm:col-span-1">
				Etiqueta propia
				<select name="etiqueta" bind:value={tagId} class={field}>
					<option value="">Todas</option>
					{#each data.own.tags as tag (tag.id)}
						<option value={String(tag.id)}>{tag.name}</option>
					{/each}
				</select>
			</label>
		{/if}
		<button
			class="{button} col-span-2 self-end bg-amber-600 font-semibold text-white hover:bg-amber-500 sm:col-span-1"
			>Buscar</button
		>
		<!-- Straight to the file, without drawing a whole year here first. -->
		<a
			href={sheet}
			download
			data-sveltekit-reload
			class="{button} col-span-2 text-center text-zinc-300 ring-1 ring-zinc-700 hover:bg-zinc-800 sm:col-span-full sm:justify-self-end"
			title="Hoja de cálculo (.ods) con todo lo que encuentren estos filtros; sin ninguno, todo"
			>⬇ Descargar hoja</a
		>
	</form>

	{#if data.asked}
		<p class="mb-2 text-sm text-zinc-400">
			{#if data.tag && data.expenses.length}
				<span class="rounded bg-amber-900/60 px-1.5 text-amber-200">{data.tag.name}</span>:
				<span class="font-semibold text-white tabular-nums">{euros(taggedTotal)}</span>
				en {taggedLines.length}
				{taggedLines.length === 1 ? 'línea' : 'líneas'} de {data.expenses.length}
				{data.expenses.length === 1 ? 'gasto' : 'gastos'}
			{:else if data.expenses.length}
				{data.expenses.length}
				{data.expenses.length === 1 ? 'gasto' : 'gastos'}:
				<span class="font-semibold text-white tabular-nums">{euros(total)}</span>
				{#if data.limit !== null && data.expenses.length === data.limit}
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
						{#if data.tag}
							{@const lines = tagged.get(e.id) ?? []}
							<span class="flex shrink-0 flex-col items-end">
								<span class="text-amber-200 tabular-nums"
									>{euros(lines.reduce((sum, l) => sum + l.amount, 0))}</span
								>
								<span class="text-xs text-zinc-500 tabular-nums">de {euros(e.total)}</span>
							</span>
						{:else}
							<span class="shrink-0 tabular-nums">{euros(e.total)}</span>
						{/if}
					</button>
					{#if open === e.id}
						<div class="mb-3 rounded-md bg-zinc-900 p-3 text-sm">
							{#if e.lines.length}
								<ul class="mb-2">
									{#each e.lines as line, i (i)}
										{@const own = ownTagOf(data.own, line.text)}
										<li class="flex justify-between gap-3">
											<span
												class="min-w-0 truncate {own && own.id === data.tag?.id
													? 'text-amber-200'
													: 'text-zinc-300'}"
												>{line.text}
												{#if own}<span class="rounded bg-amber-900/60 px-1.5 text-xs text-amber-200"
														>{own.name}</span
													>{/if}
												<span class="text-xs text-zinc-500">· {line.tag}</span></span
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
			Busca por lo que pone en la tienda o en las líneas del ticket, entre dos fechas{#if data.own.tags.length},
				por una etiqueta propia{/if}, o todo a la vez.
		</p>
	{/if}
</div>
