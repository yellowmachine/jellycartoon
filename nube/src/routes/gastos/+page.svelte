<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { afterNavigate, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import {
		BILL_KINDS,
		BILL_UNITS,
		billDays,
		type BillDetails,
		type BillInput,
		type BillKind,
		type BillUnit
	} from 'comun/bills.ts';
	import {
		EXPENSE_CATEGORIES,
		LINE_TAGS,
		addMonths,
		byTag,
		euros,
		favoriteOf,
		isFavorite,
		linesSum,
		monthName,
		parseEuros,
		type Expense,
		type ExpenseCategory,
		type ExpenseDraft,
		type ExpenseFavorite,
		type LineTag,
		type RecurringExpense
	} from 'comun/expenses.ts';
	import ExpenseTabs from '#lib/components/ExpenseTabs.svelte';
	import { smallerPhoto } from 'comun/receipt-photo.ts';
	import { takeSharedFile } from '#lib/shared-file.ts';
	import { pendingReceipt } from '#lib/pending-receipt.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Amounts as written in the boxes, «12,30»: turned into cents on saving. */
	const typed = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

	interface Editing {
		id: number | null;
		/**
		 * Written by hand or said: with lines, the total is their sum, not typed. Not one read from a
		 * photo, whose printed total is right and its lines may be misread.
		 */
		fromLines: boolean;
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
		/** A bill's (#232): its supply, the consumption as written. */
		bill: {
			kind: BillKind;
			periodStart: string;
			periodEnd: string;
			consumption: string;
			unit: BillUnit;
			details: BillDetails;
		} | null;
	}

	/** A bill as the boxes have it. */
	const billBoxes = (b: BillInput | null): Editing['bill'] =>
		b && {
			...b,
			consumption: b.consumption === null ? '' : String(b.consumption).replace('.', ',')
		};

	let editing = $state<Editing | null>(null);
	/** The form, at the top of the page: brought into view when an expense down the list opens in it. */
	let editForm = $state<HTMLElement>();
	let problem = $state<string | null>(null);
	let reading = $state<'ticket' | 'factura' | null>(null);
	let saving = $state(false);
	/** The one open in the list, with its lines: from Búsqueda, `?gasto=`. */
	let open = $state<number | null>(Number(page.url.searchParams.get('gasto')) || null);
	/** The category open in the month's totals, with its lines by tag. */
	let openCategory = $state<ExpenseCategory | null>(null);
	let deleting = $state<string | null>(null);
	let photoInput = $state<HTMLInputElement>();
	let billInput = $state<HTMLInputElement>();

	function close() {
		if (editing?.photo) URL.revokeObjectURL(editing.photo);
		editing = null;
		problem = null;
	}

	function byHand() {
		close();
		editing = {
			id: null,
			fromLines: true,
			receipt: null,
			readBy: null,
			photo: null,
			date: data.today,
			store: '',
			category: 'Supermercado',
			total: '',
			lines: [],
			bill: null
		};
	}

	/** A favourite, as a new expense of today: the amount, if it had one, to change if need be. */
	function fromFavorite(f: ExpenseFavorite) {
		byHand();
		editing = {
			...editing!,
			store: f.store,
			category: f.category,
			total: f.total === null ? '' : typed(f.total),
			lines: f.lines.map((l) => ({ ...l, amount: typed(l.amount) }))
		};
	}

	/** The form as a favourite: no day; no amount if the box is empty. */
	const asFavorite = $derived(
		editing && {
			store: editing.store,
			category: editing.category,
			total: parseEuros(editing.total),
			lines: editing.lines
				.filter((l) => l.text.trim())
				.map((l) => ({ ...l, amount: parseEuros(l.amount) ?? 0 }))
		}
	);

	/** The favourite of the name in the form, if there is one: «★» only if it is this expense. */
	const favorite = $derived(editing && favoriteOf(data.favorites, editing.store));
	const formIsFavorite = $derived(!!favorite && !!asFavorite && isFavorite(asFavorite, favorite));

	/** Saving another one of the same place takes its favourite's place: said on the button. */
	const instead = (f: ExpenseFavorite | undefined) =>
		f ? ` · en lugar del ${f.total === null ? 'que hay' : `de ${euros(f.total)}`}` : '';

	/**
	 * One in the list, in the middle of the screen. A jump, not smooth: the form opening or closing
	 * up there moves the page meanwhile, and the browser's scroll anchoring cuts a smooth one short.
	 */
	const showExpense = (id: number) =>
		document.getElementById(`gasto-${id}`)?.scrollIntoView({ block: 'center' });

	/** Corrected in the form, up there; back to it in the list when done. */
	async function edit(e: Expense) {
		close();
		editing = {
			id: e.id,
			// One that did not add up already keeps its total: not changed by opening it.
			fromLines:
				(e.source === 'mano' || e.source === 'voz') &&
				!e.bill &&
				(!e.lines.length || linesSum(e.lines) === e.total),
			receipt: null,
			readBy: null,
			photo: null,
			date: e.date,
			store: e.store,
			category: e.category,
			total: typed(e.total),
			lines: e.lines.map((l) => ({ ...l, amount: typed(l.amount) })),
			bill: billBoxes(e.bill)
		};
		await tick();
		editForm?.scrollIntoView({ block: 'start' });
	}

	/** Cancelled: back to the one it was correcting, if it was one. */
	function cancel() {
		const id = editing?.id;
		close();
		if (id) void tick().then(() => showExpense(id));
	}

	/** The photo, smaller, to the model; what it read, to check. */
	async function readPhoto(file: File | undefined) {
		if (!file) return;
		close();
		reading = 'ticket';
		const photo = await smallerPhoto(file);
		const form = new FormData();
		form.set('foto', photo, 'ticket.jpg');
		const res = await fetch('/gastos/leer', { method: 'POST', body: form }).catch(() => null);
		if (photoInput) photoInput.value = '';
		await review(res, photo);
	}

	/** A bill (#232): its PDF as it is, a photo smaller. */
	async function readBill(file: File | undefined) {
		if (!file) return;
		close();
		reading = 'factura';
		const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
		const sent = isPdf ? file : await smallerPhoto(file);
		const form = new FormData();
		form.set('factura', sent, isPdf ? 'factura.pdf' : 'factura.jpg');
		const res = await fetch('/gastos/leer-factura', { method: 'POST', body: form }).catch(
			() => null
		);
		if (billInput) billInput.value = '';
		await review(res, isPdf ? null : sent);
	}

	/** What the model read, in the boxes to check; the photo beside it, if there was one. */
	async function review(res: Response | null, photo: Blob | null) {
		const body = await res?.json().catch(() => null);
		reading = null;
		if (!res?.ok) return void (problem = body?.message ?? 'Sin conexión');
		const draft = body as ExpenseDraft;
		editing = {
			id: null,
			fromLines: false,
			receipt: draft.receipt,
			readBy: draft.readBy,
			photo: photo && URL.createObjectURL(photo),
			date: draft.date,
			store: draft.store,
			category: draft.category,
			total: draft.total ? typed(draft.total) : '',
			lines: draft.lines.map((l) => ({ ...l, amount: typed(l.amount) })),
			bill: billBoxes(draft.bill)
		};
	}

	// Shared to the app from another (the manifest's share_target, #232): a PDF, as a bill; a
	// photo, as a ticket.
	// From Búsqueda (`?gasto=`): after the navigation, which leaves the page at the top once mounted.
	afterNavigate(() => {
		const id = Number(page.url.searchParams.get('gasto'));
		if (id) document.getElementById(`gasto-${id}`)?.scrollIntoView({ block: 'center' });
	});

	onMount(() => {
		if (page.url.searchParams.get('compartido') !== 'archivo') return;
		const url = new URL(page.url.href);
		url.searchParams.delete('compartido');
		replaceState(url, {});
		void takeSharedFile().then((file) => {
			if (!file)
				return void (problem = 'No ha llegado ningún archivo. Prueba a compartirlo otra vez.');
			if (file.type === 'application/pdf') void readBill(file);
			else void readPhoto(file);
		});
	});

	// Taken with the header's shortcut, from any page: read here.
	$effect(() => {
		if (!pendingReceipt.photo) return;
		const photo = pendingReceipt.take() ?? undefined;
		untrack(() => void readPhoto(photo));
	});

	/** The lines' sum, as the total of one written by hand with lines; null otherwise or not yet. */
	const fromLinesTotal = $derived.by(() => {
		if (!editing?.fromLines) return null;
		const lines = editing.lines.filter((l) => l.text.trim());
		if (!lines.length) return null;
		const amounts = lines.map((l) => parseEuros(l.amount));
		return amounts.every((a) => a !== null)
			? amounts.reduce<number>((sum, a) => sum + a!, 0)
			: null;
	});
	const totalFromLines = $derived(
		Boolean(editing?.fromLines && editing.lines.some((l) => l.text.trim()))
	);
	// In the box too: a favourite keeps it, and it stays there if the lines go.
	$effect(() => {
		if (fromLinesTotal !== null && editing) editing.total = typed(fromLinesTotal);
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
		let bill: BillInput | null = null;
		if (editing.bill) {
			const b = editing.bill;
			const typedConsumption = b.consumption.trim().replace(/\./g, '').replace(',', '.');
			const consumption = typedConsumption ? Number(typedConsumption) : null;
			if (consumption !== null && !(consumption >= 0))
				return { error: `El consumo, en ${b.unit}: 280 o 12,5` };
			if (!b.periodStart || !b.periodEnd || b.periodEnd < b.periodStart)
				return { error: 'El periodo de la factura: del primer al último día' };
			bill = { ...b, consumption };
		}
		return {
			expense: {
				date: editing.date,
				store: editing.store,
				category: editing.category,
				total,
				lines: lines.filter((l) => l.text.trim()).map((l) => ({ ...l, amount: l.amount ?? 0 })),
				bill
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

	const shortDay = (day: string) =>
		new Date(`${day}T12:00:00Z`).toLocaleDateString('es-ES', {
			day: 'numeric',
			month: 'short',
			timeZone: 'UTC'
		});

	const SOURCES: Record<Expense['source'], string> = {
		ticket: '📷',
		factura: '📄',
		voz: '🎙',
		mano: '✍',
		fijo: '🔁'
	};

	/** A fixed one being written: new, or which. */
	let fixed = $state<
		(Omit<RecurringExpense, 'id' | 'amount'> & { id: number | null; amount: string }) | null
	>(null);
	let fixedForm = $state<HTMLFormElement>();
	/** Where the page was when it opened: back there on closing it. */
	let fixedFrom = 0;

	/** Its form goes under the list: brought into view, with many it would be out of sight. */
	async function openFixed(value: NonNullable<typeof fixed>) {
		if (!fixed) fixedFrom = window.scrollY;
		fixed = value;
		await tick();
		fixedForm?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	}

	function closeFixed() {
		fixed = null;
		window.scrollTo({ top: fixedFrom, behavior: 'smooth' });
	}

	const field =
		'rounded-md border-zinc-700 bg-zinc-950 py-1.5 text-sm focus:border-amber-500 focus:ring-amber-500';
	const button = 'rounded-md px-3 py-1.5 text-sm disabled:opacity-40';
</script>

<svelte:head>
	<title>Gastos · Seilide</title>
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
				{reading === 'ticket' ? 'Leyendo el ticket…' : '📷 Ticket'}
				<input
					bind:this={photoInput}
					type="file"
					accept="image/*"
					capture="environment"
					class="hidden"
					onchange={(e) => readPhoto(e.currentTarget.files?.[0])}
				/>
			</label>
			<label
				class={[
					'cursor-pointer rounded-md bg-zinc-800 px-4 py-2 hover:bg-zinc-700',
					reading && 'pointer-events-none opacity-60'
				]}
			>
				{reading === 'factura' ? 'Leyendo la factura…' : '📄 Factura'}
				<input
					bind:this={billInput}
					type="file"
					accept="application/pdf,.pdf,image/*"
					class="hidden"
					onchange={(e) => readBill(e.currentTarget.files?.[0])}
				/>
			</label>
		{/if}
		<button class="rounded-md bg-zinc-800 px-4 py-2 hover:bg-zinc-700" onclick={byHand}
			>+ A mano</button
		>
	</div>
	{#if data.favorites.length}
		<div class="-mt-3 mb-6 flex flex-wrap gap-2" aria-label="Favoritos">
			{#each data.favorites as f (f.id)}
				<button
					class="rounded-full border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-800"
					onclick={() => fromFavorite(f)}
					><span class="text-amber-400">★</span>
					{f.store}{f.total === null ? '' : ` · ${euros(f.total)}`}</button
				>
			{/each}
		</div>
	{/if}
	{#if reading === 'factura'}
		<p class="mb-4 text-sm text-zinc-400">
			Unos segundos. Un PDF se lee por su texto, sin tu nombre, DNI, cuenta ni CUPS.
		</p>
	{:else if reading}
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
		<section
			bind:this={editForm}
			class="mb-8 scroll-mt-[calc(var(--header-h,0px)+1rem)] rounded-lg border border-zinc-700 bg-zinc-900 p-4"
		>
			<h2 class="mb-1 font-semibold">
				{e.id
					? e.bill
						? 'Corregir la factura'
						: 'Corregir el gasto'
					: e.receipt
						? 'Revisa lo que se ha leído'
						: 'Nuevo gasto'}
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
								readonly={totalFromLines}
								title={totalFromLines ? 'La suma de las líneas' : undefined}
								class={[`${field} text-right`, totalFromLines && 'text-zinc-400']}
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

					{#if e.bill}
						{@const b = e.bill}
						<div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
							<label class="flex flex-col gap-1 text-xs text-zinc-400">
								Factura de
								<select bind:value={b.kind} class={field}>
									{#each BILL_KINDS as k (k)}
										<option value={k}>{k}</option>
									{/each}
								</select>
							</label>
							<label class="flex flex-col gap-1 text-xs text-zinc-400">
								Consumo
								<span class="flex gap-1">
									<input
										bind:value={b.consumption}
										inputmode="decimal"
										class="{field} min-w-0 flex-1 text-right"
									/>
									<select bind:value={b.unit} class="{field} w-24 shrink-0" aria-label="Unidad">
										{#each BILL_UNITS as u (u)}
											<option value={u}>{u}</option>
										{/each}
									</select>
								</span>
							</label>
							<label class="flex flex-col gap-1 text-xs text-zinc-400">
								Desde
								<input type="date" bind:value={b.periodStart} class={field} />
							</label>
							<label class="flex flex-col gap-1 text-xs text-zinc-400">
								Hasta
								<input type="date" bind:value={b.periodEnd} class={field} />
							</label>
						</div>
						{#if b.details.consumption.length || b.details.power.length}
							<p class="mt-2 text-xs text-zinc-500">
								{#if b.details.consumption.length}
									{b.details.consumption.map((p) => `${p.name}: ${p.value} ${b.unit}`).join(' · ')}
								{/if}
								{#if b.details.power.length}
									<br />Potencia {b.details.power.map((p) => `${p.name} ${p.value} kW`).join(' · ')}
									{#if b.details.maxPower.length}
										(máxima usada {b.details.maxPower.map((p) => `${p.value}`).join(' y ')} kW)
									{/if}
								{/if}
							</p>
						{/if}
					{/if}

					<h3 class="mt-4 mb-1 text-sm text-zinc-300">
						{e.bill ? 'Desglose' : 'Líneas'}
						{#if e.lines.length}<span class="text-zinc-500">({e.lines.length})</span>{/if}
					</h3>
					<ul class="flex flex-col gap-1">
						{#each e.lines as line, i (i)}
							<li class="flex items-center gap-1">
								<input
									bind:value={line.text}
									aria-label="Línea {i + 1}"
									class="{field} min-w-0 flex-1"
								/>
								<!-- A bill's parts are all of one thing: no kind to choose. -->
								{#if !e.bill}
									<select
										bind:value={line.tag}
										aria-label="Qué es la línea {i + 1}"
										class="{field} w-28 shrink-0 truncate"
									>
										{#each LINE_TAGS as t (t)}
											<option value={t}>{t}</option>
										{/each}
									</select>
								{/if}
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
					{#if totalFromLines}
						<p class="mt-1 text-xs text-zinc-500">
							El total es la suma de las líneas. Un descuento, en negativo: -2,00.
						</p>
					{/if}
					{#if mismatch}
						<p class="mt-2 text-sm text-amber-300">
							{e.bill ? 'El desglose suma' : 'Las líneas suman'}
							{euros(mismatch.sum)}, y el total es {euros(mismatch.total)}: revisa si se ha leído
							mal alguna{e.bill
								? ' (a veces el resumen de la factura no coincide con su desglose)'
								: ', o falta un descuento'}.
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
								// Saved: shown where it is now (a changed day moves it, or to another month).
								if (result.type === 'success' && open) {
									await tick();
									showExpense(open);
								}
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
						<button type="button" class="{button} hover:bg-zinc-800" onclick={cancel}
							>Cancelar</button
						>
						{#if problem}<span class="text-sm text-red-400">{problem}</span>{/if}
					</form>
					<!-- To put it in again with a touch, or by voice («el café de siempre»). -->
					{#if !e.bill && e.store.trim()}
						<form
							method="post"
							action={formIsFavorite ? '?/deleteFavorite' : '?/saveFavorite'}
							class="mt-2"
							use:enhance={() =>
								async ({ update }) =>
									update({ reset: false })}
						>
							{#if formIsFavorite}
								<input type="hidden" name="id" value={favorite!.id} />
							{:else}
								<input type="hidden" name="favorite" value={JSON.stringify(asFavorite)} />
							{/if}
							<button class="text-sm text-amber-400 hover:underline">
								{formIsFavorite
									? '★ Favorito · quitar'
									: `☆ Guardar como favorito${instead(favorite ?? undefined)}`}
							</button>
						</form>
					{/if}
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
			<li id="gasto-{e.id}">
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
						{#if e.bill}
							{@const b = e.bill}
							<p class="mb-2 text-zinc-300">
								{b.kind}, del {shortDay(b.periodStart)} al {shortDay(b.periodEnd)} ({billDays(b)} días){#if b.consumption}:
									<span class="font-semibold text-white tabular-nums"
										>{b.consumption.toLocaleString('es-ES')} {b.unit}</span
									>, {euros(Math.round(e.total / b.consumption))}/{b.unit} con todo{/if}
							</p>
						{/if}
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
									class="{button} bg-zinc-800 hover:bg-zinc-700"
									>{e.bill ? 'Ver factura' : 'Ver ticket'}</a
								>
							{/if}
							<button class="{button} bg-zinc-800 hover:bg-zinc-700" onclick={() => edit(e)}
								>Corregir</button
							>
							<!-- As in the form, without opening it to correct: «♥» only if it is this expense. -->
							{#if !e.bill}
								{@const placeFav = favoriteOf(data.favorites, e.store)}
								{@const fav = placeFav && isFavorite(e, placeFav) ? placeFav : null}
								<form
									method="post"
									action={fav ? '?/deleteFavorite' : '?/saveFavorite'}
									use:enhance={() =>
										async ({ update }) =>
											update({ reset: false })}
								>
									{#if fav}
										<input type="hidden" name="id" value={fav.id} />
									{:else}
										<input
											type="hidden"
											name="favorite"
											value={JSON.stringify({
												store: e.store,
												category: e.category,
												total: e.total,
												lines: e.lines
											})}
										/>
									{/if}
									<button
										class="{button} flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700"
										aria-pressed={!!fav}
									>
										<svg
											viewBox="0 0 24 24"
											class="h-4 w-4 {fav ? 'text-amber-400' : 'text-zinc-400'}"
											aria-hidden="true"
										>
											<path
												d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.6 3.9 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.3 0 5.6 3.1 4.4 6.6-1.7 4.8-9.2 9.4-9.2 9.4Z"
												fill={fav ? 'currentColor' : 'none'}
												stroke="currentColor"
												stroke-width="2"
												stroke-linejoin="round"
											/>
										</svg>
										{fav ? 'Quitar de favoritos' : `Favorito${instead(placeFav)}`}
									</button>
								</form>
							{/if}
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
						onclick={() => openFixed({ ...r, amount: typed(r.amount) })}>Cambiar</button
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
				bind:this={fixedForm}
				class="flex flex-wrap items-end gap-2 rounded-lg bg-zinc-900 p-3"
				use:enhance={() =>
					async ({ result, update }) => {
						if (result.type === 'failure')
							problem = String(result.data?.message ?? 'No se pudo guardar');
						await update({ reset: false });
						if (result.type === 'success') closeFixed();
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
				<button type="button" class="{button} hover:bg-zinc-800" onclick={closeFixed}
					>Cancelar</button
				>
			</form>
		{:else}
			<button
				class="text-sm text-amber-400 hover:underline"
				onclick={() => openFixed({ id: null, name: '', category: 'Facturas', amount: '', day: 1 })}
				>+ Fijo</button
			>
		{/if}
	</section>
</div>
