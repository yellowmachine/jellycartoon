<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import {
		EXPENSE_CATEGORIES,
		LINE_TAGS,
		addMonths,
		byTag,
		euros,
		linesSum,
		monthName,
		parseEuros,
		type Expense,
		type ExpenseCategory,
		type ExpenseDraft,
		type LineTag,
		type RecurringExpense
	} from '#lib/expenses.ts';
	import ExpenseTabs from '#lib/components/ExpenseTabs.svelte';
	import { smallerPhoto } from '#lib/receipt-photo.ts';
	import { pendingReceipt } from '#lib/pending-receipt.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Amounts as written in the boxes, «12,30»: turned into cents on saving. */
	const typed = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

	interface Editing {
		id: number | null;
		/** A receipt read and waiting to be kept with it. */
		receipt: string | null;
		readBy: ExpenseDraft['readBy'] | null;
		/** The photo, as taken: to compare with what was read. */
		photo: string | null;
		date: string;
		store: string;
		category: ExpenseCategory;
		total: string;
		lines: { text: string; quantity: number | null; amount: string; tag: LineTag }[];
	}

	let editing = $state<Editing | null>(null);
	let problem = $state<string | null>(null);
	let reading = $state(false);
	let saving = $state(false);
	/** The one open in the list, with its lines. */
	let open = $state<number | null>(null);
	/** The category open in the month's totals, with its lines by tag. */
	let openCategory = $state<ExpenseCategory | null>(null);
	let deleting = $state<string | null>(null);
	let photoInput = $state<HTMLInputElement>();

	function close() {
		if (editing?.photo) URL.revokeObjectURL(editing.photo);
		editing = null;
		problem = null;
	}

	function byHand() {
		close();
		editing = {
			id: null,
			receipt: null,
			readBy: null,
			photo: null,
			date: data.today,
			store: '',
			category: 'Supermercado',
			total: '',
			lines: []
		};
	}

	function edit(e: Expense) {
		close();
		editing = {
			id: e.id,
			receipt: null,
			readBy: null,
			photo: null,
			date: e.date,
			store: e.store,
			category: e.category,
			total: typed(e.total),
			lines: e.lines.map((l) => ({ ...l, amount: typed(l.amount) }))
		};
	}

	/** The photo, smaller, to the model; what it read, to check. */
	async function readPhoto(file: File | undefined) {
		if (!file) return;
		close();
		reading = true;
		const photo = await smallerPhoto(file);
		const form = new FormData();
		form.set('foto', photo, 'ticket.jpg');
		const res = await fetch('/gastos/leer', { method: 'POST', body: form }).catch(() => null);
		const body = await res?.json().catch(() => null);
		reading = false;
		if (photoInput) photoInput.value = '';
		if (!res?.ok) return void (problem = body?.message ?? 'Sin conexión');
		const draft = body as ExpenseDraft;
		editing = {
			id: null,
			receipt: draft.receipt,
			readBy: draft.readBy,
			photo: URL.createObjectURL(photo),
			date: draft.date,
			store: draft.store,
			category: draft.category,
			total: draft.total ? typed(draft.total) : '',
			lines: draft.lines.map((l) => ({ ...l, amount: typed(l.amount) }))
		};
	}

	// Taken with the header's shortcut, from any page: read here.
	$effect(() => {
		if (!pendingReceipt.photo) return;
		const photo = pendingReceipt.take() ?? undefined;
		untrack(() => void readPhoto(photo));
	});

	/** What the boxes say, as the server takes it; or why not yet. */
	const asInput = $derived.by(() => {
		if (!editing) return null;
		const total = parseEuros(editing.total);
		const lines = editing.lines.map((l) => ({
			text: l.text,
			quantity: l.quantity,
			amount: parseEuros(l.amount),
			tag: l.tag
		}));
		if (total === null) return { error: 'Falta el total, en euros: 12,30' };
		const bad = lines.findIndex((l) => l.text.trim() && l.amount === null);
		if (bad >= 0) return { error: `La línea ${bad + 1} no tiene un importe válido` };
		return {
			expense: {
				date: editing.date,
				store: editing.store,
				category: editing.category,
				total,
				lines: lines.filter((l) => l.text.trim()).map((l) => ({ ...l, amount: l.amount ?? 0 }))
			}
		};
	});

	/** The lines that do not add up to the total: something misread, or a discount missing. */
	const mismatch = $derived.by(() => {
		const input = asInput && 'expense' in asInput ? asInput.expense : null;
		if (!input?.lines.length) return null;
		const sum = linesSum(input.lines);
		return sum === input.total ? null : { sum, total: input.total };
	});

	const total = $derived(data.expenses.reduce((sum, e) => sum + e.total, 0));
	const byCategory = $derived(
		EXPENSE_CATEGORIES.map((category) => {
			const expenses = data.expenses.filter((e) => e.category === category);
			return {
				category,
				total: expenses.reduce((sum, e) => sum + e.total, 0),
				// Only where its lines are of more than one kind: «Gasolina ▸ Combustible» says nothing.
				tags: expenses.some((e) => e.lines.length) ? byTag(expenses) : []
			};
		})
			.filter((c) => c.total > 0)
			.map((c) => (c.tags.length > 1 ? c : { ...c, tags: [] }))
			.sort((a, b) => b.total - a.total)
	);
	const largest = $derived(byCategory[0]?.total ?? 0);

	const dayText = (day: string) =>
		new Date(`${day}T12:00:00Z`).toLocaleDateString('es-ES', {
			weekday: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		});

	const SOURCES: Record<Expense['source'], string> = {
		ticket: '📷',
		voz: '🎙',
		mano: '✍',
		fijo: '🔁'
	};

	/** A fixed one being written: new, or which. */
	let fixed = $state<
		(Omit<RecurringExpense, 'id' | 'amount'> & { id: number | null; amount: string }) | null
	>(null);

	const field =
		'rounded-md border-zinc-700 bg-zinc-950 py-1.5 text-sm focus:border-amber-500 focus:ring-amber-500';
	const button = 'rounded-md px-3 py-1.5 text-sm disabled:opacity-40';
</script>

<svelte:head>
	<title>Gastos · JellyCartoon</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<h1 class="mb-3 text-2xl font-bold">Gastos</h1>
	<ExpenseTabs current="mes" />
	<p class="mb-4 text-sm text-zinc-400">
		Los de la casa, para todos los adultos. Con una foto del ticket, a mano, por voz («he gastado 40
		euros en gasolina») o fijos de cada mes.
	</p>

	<div class="mb-6 flex flex-wrap gap-2">
		{#if data.canRead}
			<label
				class={[
					'cursor-pointer rounded-md bg-amber-500 px-4 py-2 font-semibold text-zinc-950 hover:bg-amber-400',
					reading && 'pointer-events-none opacity-60'
				]}
			>
				{reading ? 'Leyendo el ticket…' : '📷 Ticket'}
				<input
					bind:this={photoInput}
					type="file"
					accept="image/*"
					capture="environment"
					class="hidden"
					onchange={(e) => readPhoto(e.currentTarget.files?.[0])}
				/>
			</label>
		{/if}
		<button class="rounded-md bg-zinc-800 px-4 py-2 hover:bg-zinc-700" onclick={byHand}
			>+ A mano</button
		>
	</div>
	{#if reading}
		<p class="mb-4 text-sm text-zinc-400">
			Unos segundos. Si OpenRouter falla y lo lee Ollama en casa, la primera vez tarda más, mientras
			carga el modelo.
		</p>
	{/if}
	{#if problem && !editing}
		<p class="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-200">{problem}</p>
	{/if}

	{#if editing}
		{@const e = editing}
		<section class="mb-8 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
			<h2 class="mb-1 font-semibold">
				{e.id ? 'Corregir el gasto' : e.receipt ? 'Revisa lo que se ha leído' : 'Nuevo gasto'}
			</h2>
			{#if e.readBy}
				<p class="mb-3 text-xs text-zinc-500">
					Leído {e.readBy === 'ollama' ? 'en casa (Ollama)' : 'con OpenRouter'}. Corrige lo que haga
					falta y guarda.
				</p>
			{/if}
			<div class="flex flex-col gap-4 sm:flex-row">
				{#if e.photo}
					<a href={e.photo} target="_blank" class="shrink-0 self-start">
						<img
							src={e.photo}
							alt="El ticket"
							class="max-h-80 w-full rounded border border-zinc-700 object-contain sm:w-40"
						/>
					</a>
				{/if}
				<div class="min-w-0 flex-1">
					<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
						<label class="col-span-2 flex flex-col gap-1 text-xs text-zinc-400">
							Dónde
							<input bind:value={e.store} maxlength="120" class={field} placeholder="Mercadona" />
						</label>
						<label class="flex flex-col gap-1 text-xs text-zinc-400">
							Día
							<input type="date" bind:value={e.date} max={data.today} class={field} />
						</label>
						<label class="flex flex-col gap-1 text-xs text-zinc-400">
							Total (€)
							<input
								bind:value={e.total}
								inputmode="decimal"
								class="{field} text-right"
								placeholder="0,00"
							/>
						</label>
						<label class="col-span-2 flex flex-col gap-1 text-xs text-zinc-400 sm:col-span-4">
							Categoría
							<select bind:value={e.category} class={field}>
								{#each EXPENSE_CATEGORIES as c (c)}
									<option value={c}>{c}</option>
								{/each}
							</select>
						</label>
					</div>

					<h3 class="mt-4 mb-1 text-sm text-zinc-300">
						Líneas {#if e.lines.length}<span class="text-zinc-500">({e.lines.length})</span>{/if}
					</h3>
					<ul class="flex flex-col gap-1">
						{#each e.lines as line, i (i)}
							<li class="flex items-center gap-1">
								<input
									bind:value={line.text}
									aria-label="Línea {i + 1}"
									class="{field} min-w-0 flex-1"
								/>
								<select
									bind:value={line.tag}
									aria-label="Qué es la línea {i + 1}"
									class="{field} w-28 shrink-0 truncate"
								>
									{#each LINE_TAGS as t (t)}
										<option value={t}>{t}</option>
									{/each}
								</select>
								<input
									bind:value={line.amount}
									inputmode="decimal"
									aria-label="Importe de la línea {i + 1}"
									class="{field} w-20 text-right"
								/>
								<button
									class="rounded px-2 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-white"
									aria-label="Quitar la línea {i + 1}"
									onclick={() => e.lines.splice(i, 1)}>✕</button
								>
							</li>
						{/each}
					</ul>
					<button
						class="mt-1 text-sm text-amber-400 hover:underline"
						onclick={() => e.lines.push({ text: '', quantity: null, amount: '', tag: 'Otros' })}
						>+ Línea</button
					>
					{#if mismatch}
						<p class="mt-2 text-sm text-amber-300">
							Las líneas suman {euros(mismatch.sum)}, y el total es {euros(mismatch.total)}: revisa
							si se ha leído mal alguna, o falta un descuento.
						</p>
					{/if}

					<form
						method="post"
						action="?/save"
						class="mt-4 flex flex-wrap items-center gap-2"
						use:enhance={({ cancel }) => {
							if (!asInput || 'error' in asInput) {
								problem = asInput?.error ?? null;
								return cancel();
							}
							saving = true;
							return async ({ result, update }) => {
								saving = false;
								if (result.type === 'success') {
									open = Number(result.data?.saved) || null;
									close();
								} else if (result.type === 'failure')
									problem = String(result.data?.message ?? 'No se pudo guardar');
								await update({ reset: false });
							};
						}}
					>
						{#if e.id}<input type="hidden" name="id" value={e.id} />{/if}
						{#if e.receipt}<input type="hidden" name="receipt" value={e.receipt} />{/if}
						<input
							type="hidden"
							name="expense"
							value={asInput && 'expense' in asInput ? JSON.stringify(asInput.expense) : ''}
						/>
						<button
							class="{button} bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400"
							disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button
						>
						<button type="button" class="{button} hover:bg-zinc-800" onclick={close}
							>Cancelar</button
						>
						{#if problem}<span class="text-sm text-red-400">{problem}</span>{/if}
					</form>
				</div>
			</div>
		</section>
	{/if}

	<nav class="mb-4 flex items-center justify-between gap-2">
		<a
			href="?mes={addMonths(data.month, -1)}"
			class="rounded-md px-3 py-1 text-xl hover:bg-zinc-800"
			aria-label="Mes anterior">‹</a
		>
		<h2 class="text-lg font-semibold first-letter:uppercase">{monthName(data.month)}</h2>
		{#if data.month < data.current}
			<a
				href="?mes={addMonths(data.month, 1)}"
				class="rounded-md px-3 py-1 text-xl hover:bg-zinc-800"
				aria-label="Mes siguiente">›</a
			>
		{:else}
			<span class="w-10"></span>
		{/if}
	</nav>

	<section class="mb-6 rounded-lg bg-zinc-900 p-4">
		<p class="text-3xl font-bold tabular-nums">{euros(total)}</p>
		<p class="mb-3 text-sm text-zinc-400">
			{data.previous
				? `El mes anterior, ${euros(data.previous)}`
				: 'Sin gastos apuntados el mes anterior'}
		</p>
		<ul class="flex flex-col gap-1.5">
			{#each byCategory as c (c.category)}
				<li>
					<svelte:element
						this={c.tags.length ? 'button' : 'div'}
						class="grid w-full grid-cols-[8rem_1fr_auto] items-center gap-2 text-left text-sm"
						aria-expanded={c.tags.length ? openCategory === c.category : undefined}
						onclick={c.tags.length
							? () => (openCategory = openCategory === c.category ? null : c.category)
							: undefined}
						role={c.tags.length ? undefined : 'presentation'}
					>
						<span class="truncate"
							>{c.category}{#if c.tags.length}<span class="text-zinc-500">
									{openCategory === c.category ? '▾' : '▸'}</span
								>{/if}</span
						>
						<span class="h-2 overflow-hidden rounded-full bg-zinc-800">
							<span
								class="block h-full rounded-full bg-amber-500"
								style:width="{(c.total / largest) * 100}%"
							></span>
						</span>
						<span class="text-right tabular-nums">{euros(c.total)}</span>
					</svelte:element>
					{#if openCategory === c.category}
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
			{/each}
		</ul>
	</section>

	<ul class="mb-10 divide-y divide-zinc-800">
		{#each data.expenses as e (e.id)}
			<li>
				<button
					class="flex w-full items-center gap-3 py-2 text-left hover:bg-zinc-900"
					aria-expanded={open === e.id}
					onclick={() => (open = open === e.id ? null : e.id)}
				>
					<span class="w-14 shrink-0 text-sm text-zinc-400">{dayText(e.date)}</span>
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
							{#if linesSum(e.lines) !== e.total}
								<p class="mb-2 text-xs text-amber-300">
									Las líneas suman {euros(linesSum(e.lines))}.
								</p>
							{/if}
						{/if}
						<div class="flex flex-wrap items-center gap-2">
							{#if e.hasReceipt}
								<a
									href="/gastos/ticket/{e.id}"
									target="_blank"
									class="{button} bg-zinc-800 hover:bg-zinc-700">Ver ticket</a
								>
							{/if}
							<button class="{button} bg-zinc-800 hover:bg-zinc-700" onclick={() => edit(e)}
								>Corregir</button
							>
							{#if deleting === `gasto-${e.id}`}
								<form method="post" action="?/delete" use:enhance class="flex gap-2">
									<input type="hidden" name="id" value={e.id} />
									<span class="py-1.5">¿Borrarlo?</span>
									<button class="{button} bg-red-700 hover:bg-red-600">Sí</button>
									<button
										type="button"
										class="{button} hover:bg-zinc-800"
										onclick={() => (deleting = null)}>No</button
									>
								</form>
							{:else}
								<button
									class="{button} text-zinc-400 hover:bg-zinc-800"
									onclick={() => (deleting = `gasto-${e.id}`)}>Borrar</button
								>
							{/if}
						</div>
					</div>
				{/if}
			</li>
		{:else}
			<li class="py-4 text-zinc-400">Nada apuntado este mes.</li>
		{/each}
	</ul>

	<section class="mb-10">
		<h2 class="mb-1 font-semibold">Fijos de cada mes</h2>
		<p class="mb-3 text-sm text-zinc-400">
			Se apuntan solos el día que toca. Uno nuevo empieza este mes si su día aún no ha llegado, y si
			no, el que viene.
		</p>
		<ul class="mb-3 divide-y divide-zinc-800">
			{#each data.recurring as r (r.id)}
				<li class="flex items-center gap-3 py-2">
					<span class="w-14 shrink-0 text-sm text-zinc-400">día {r.day}</span>
					<span class="min-w-0 flex-1">
						<span class="block truncate">{r.name}</span>
						<span class="block text-xs text-zinc-500">{r.category}</span>
					</span>
					<span class="tabular-nums">{euros(r.amount)}</span>
					<button
						class="{button} hover:bg-zinc-800"
						onclick={() => (fixed = { ...r, amount: typed(r.amount) })}>Cambiar</button
					>
					{#if deleting === `fijo-${r.id}`}
						<form method="post" action="?/deleteRecurring" use:enhance class="flex gap-1">
							<input type="hidden" name="id" value={r.id} />
							<button class="{button} bg-red-700 hover:bg-red-600">Quitar</button>
							<button
								type="button"
								class="{button} hover:bg-zinc-800"
								onclick={() => (deleting = null)}>No</button
							>
						</form>
					{:else}
						<button
							class="{button} text-zinc-400 hover:bg-zinc-800"
							aria-label="Quitar {r.name}"
							onclick={() => (deleting = `fijo-${r.id}`)}>✕</button
						>
					{/if}
				</li>
			{/each}
		</ul>
		{#if fixed}
			{@const f = fixed}
			<form
				method="post"
				action="?/saveRecurring"
				class="flex flex-wrap items-end gap-2 rounded-lg bg-zinc-900 p-3"
				use:enhance={() =>
					async ({ result, update }) => {
						if (result.type === 'success') fixed = null;
						else if (result.type === 'failure')
							problem = String(result.data?.message ?? 'No se pudo guardar');
						await update({ reset: false });
					}}
			>
				{#if f.id}<input type="hidden" name="id" value={f.id} />{/if}
				<input type="hidden" name="amount" value={parseEuros(f.amount) ?? ''} />
				<label class="flex min-w-40 flex-1 flex-col gap-1 text-xs text-zinc-400">
					Qué
					<input
						name="name"
						bind:value={f.name}
						maxlength="120"
						class={field}
						placeholder="Alquiler"
					/>
				</label>
				<label class="flex flex-col gap-1 text-xs text-zinc-400">
					Categoría
					<select name="category" bind:value={f.category} class={field}>
						{#each EXPENSE_CATEGORIES as c (c)}
							<option value={c}>{c}</option>
						{/each}
					</select>
				</label>
				<label class="flex w-24 flex-col gap-1 text-xs text-zinc-400">
					Importe (€)
					<input bind:value={f.amount} inputmode="decimal" class="{field} text-right" />
				</label>
				<label class="flex w-20 flex-col gap-1 text-xs text-zinc-400">
					Día
					<input
						name="day"
						type="number"
						min="1"
						max="28"
						bind:value={f.day}
						class="{field} text-right"
					/>
				</label>
				<button class="{button} bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400"
					>Guardar</button
				>
				<button type="button" class="{button} hover:bg-zinc-800" onclick={() => (fixed = null)}
					>Cancelar</button
				>
			</form>
		{:else}
			<button
				class="text-sm text-amber-400 hover:underline"
				onclick={() => (fixed = { id: null, name: '', category: 'Facturas', amount: '', day: 1 })}
				>+ Fijo</button
			>
		{/if}
	</section>
</div>
