<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { addMonths, euros, monthName } from 'comun/expenses.ts';
	import { smallerPhoto } from 'comun/receipt-photo.ts';
	import {
		INCOME_CATEGORIES,
		MAX_CONCEPT,
		type Income,
		type IncomeCategory
	} from 'comun/income.ts';
	import ExpenseTabs from '#lib/components/ExpenseTabs.svelte';
	import type { PageProps } from './$types';

	/**
	 * Dinero → Ingresos (#384): what came in this month, each with its invoice (a photo or a PDF),
	 * and the month's difference with its expenses. Written down by hand, from a photo or a file
	 * (read by the AI, to check before saving), or by voice.
	 */
	let { data, form }: PageProps = $props();

	const total = $derived(data.incomes.reduce((sum, i) => sum + i.amount, 0));
	const difference = $derived(total - data.spent);

	/** The one being written: new (`id` null) or corrected. */
	interface Draft {
		id: number | null;
		date: string;
		concept: string;
		category: IncomeCategory;
		amount: string;
		hasDocument: boolean;
	}
	let draft = $state<Draft | null>(null);
	let problem = $state<string | null>(null);
	/** The invoice chosen in the form, to read it before saving. */
	let chosen = $state<File | null>(null);
	let reading = $state(false);

	/**
	 * What the invoice says, by the AI (/gastos/ingresos/leer), into the form: what it could read,
	 * over what was there. Nothing is saved: the form sends the file with the income.
	 */
	async function readInvoice() {
		if (!chosen || !draft) return;
		reading = true;
		problem = null;
		const body = new FormData();
		body.set('factura', chosen);
		const res = await fetch('/gastos/ingresos/leer', { method: 'POST', body }).catch(() => null);
		reading = false;
		if (!res?.ok) {
			problem = (await res?.json().catch(() => null))?.message ?? 'No se pudo leer la factura';
			return;
		}
		const read: { date?: string; concept?: string; category?: IncomeCategory; amount?: number } =
			await res.json();
		if (!draft) return;
		if (read.concept) draft.concept = read.concept;
		if (read.category) draft.category = read.category;
		if (read.amount) draft.amount = typed(read.amount);
		if (read.date) draft.date = read.date;
	}

	/** The form's own file input: what it sends with the income. */
	let documentInput = $state<HTMLInputElement>();

	/** A PDF as it is; a photo smaller, as the tickets': as a file, for the form's input. */
	async function asInvoice(file: File) {
		if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return file;
		const photo = await smallerPhoto(file);
		return photo instanceof File ? photo : new File([photo], 'factura.jpg', { type: photo.type });
	}

	/** A new one from a photo or a file: the form open with it as its invoice, and read. */
	async function fromDocument(input: HTMLInputElement) {
		const original = input.files?.[0];
		// The same file can be chosen again after cancelling.
		input.value = '';
		if (!original) return;
		newOne();
		reading = true;
		const file = await asInvoice(original);
		chosen = file;
		await tick();
		const picked = new DataTransfer();
		picked.items.add(file);
		if (documentInput) documentInput.files = picked.files;
		await readInvoice();
	}

	/** The one asked «¿Borrar?» about. */
	let deleting = $state<number | null>(null);

	const typed = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

	function newOne() {
		problem = null;
		chosen = null;
		// In the month being looked at: its last day if it is not this one.
		const date = data.month === data.current ? data.today : `${data.month}-${lastDay(data.month)}`;
		draft = { id: null, date, concept: '', category: 'Otros', amount: '', hasDocument: false };
	}

	function edit(i: Income) {
		problem = null;
		chosen = null;
		draft = {
			id: i.id,
			date: i.date,
			concept: i.concept,
			category: i.category,
			amount: typed(i.amount),
			hasDocument: i.document !== null
		};
	}

	function lastDay(month: string) {
		const [y, m] = month.split('-').map(Number);
		return String(new Date(Date.UTC(y!, m!, 0)).getUTCDate()).padStart(2, '0');
	}

	const day = (date: string) =>
		new Date(`${date}T12:00:00Z`).toLocaleDateString('es-ES', {
			day: 'numeric',
			month: 'short',
			timeZone: 'UTC'
		});

	const field =
		'rounded-md border-zinc-700 bg-zinc-950 py-1.5 text-sm focus:border-amber-500 focus:ring-amber-500';
	const button = 'rounded-md px-3 py-1.5 text-sm disabled:opacity-40';
</script>

<svelte:head>
	<title>Ingresos · Dinero · Seilide</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<h1 class="mb-3 text-2xl font-bold">Dinero</h1>
	<ExpenseTabs current="ingresos" />
	<p class="mb-4 text-sm text-zinc-400">
		Lo que entra en casa: una cosecha vendida, una devolución, una nómina… Cada uno con su factura,
		si la hay, en foto o en PDF, que la IA puede leer. También por voz: «apunta un ingreso de 800
		euros de la cosecha».
	</p>

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

	<section class="mb-6 grid grid-cols-3 gap-2 rounded-lg bg-zinc-900 p-4 text-center">
		<div>
			<p class="text-xs text-zinc-400">Ingresos</p>
			<p class="text-xl font-bold text-emerald-400 tabular-nums">{euros(total)}</p>
		</div>
		<div>
			<p class="text-xs text-zinc-400">Gastos</p>
			<p class="text-xl font-bold tabular-nums">{euros(data.spent)}</p>
		</div>
		<div>
			<p class="text-xs text-zinc-400">Diferencia</p>
			<p
				class={[
					'text-xl font-bold tabular-nums',
					difference < 0 ? 'text-red-400' : 'text-emerald-400'
				]}
			>
				{difference > 0 ? '+' : ''}{euros(difference)}
			</p>
		</div>
	</section>

	{#if draft}
		<form
			method="post"
			action="?/save"
			enctype="multipart/form-data"
			class="mb-6 flex flex-wrap items-end gap-2 rounded-lg bg-zinc-900 p-3"
			use:enhance={() =>
				async ({ result, update }) => {
					if (result.type === 'failure')
						problem = String(result.data?.message ?? 'No se pudo guardar');
					await update();
					if (result.type === 'success') draft = null;
				}}
		>
			{#if draft.id}<input type="hidden" name="id" value={draft.id} />{/if}
			<label class="flex min-w-48 flex-1 flex-col gap-1 text-xs text-zinc-400">
				Qué fue
				<input
					name="concept"
					bind:value={draft.concept}
					maxlength={MAX_CONCEPT}
					required
					class={field}
					placeholder="Cosecha de almendra"
				/>
			</label>
			<label class="flex flex-col gap-1 text-xs text-zinc-400">
				Categoría
				<select name="category" bind:value={draft.category} class={field}>
					{#each INCOME_CATEGORIES as c (c)}
						<option value={c}>{c}</option>
					{/each}
				</select>
			</label>
			<label class="flex w-28 flex-col gap-1 text-xs text-zinc-400">
				Importe (€)
				<input
					name="amount"
					bind:value={draft.amount}
					inputmode="decimal"
					required
					class="{field} text-right"
					placeholder="800,00"
				/>
			</label>
			<label class="flex flex-col gap-1 text-xs text-zinc-400">
				Fecha
				<input
					name="date"
					type="date"
					bind:value={draft.date}
					max={data.today}
					required
					class={field}
				/>
			</label>
			<label class="flex w-full flex-col gap-1 text-xs text-zinc-400">
				{draft.hasDocument ? 'Otra factura (si quieres cambiarla)' : 'Factura (si la hay)'}
				<input
					bind:this={documentInput}
					name="factura"
					type="file"
					accept="application/pdf,.pdf"
					class="text-sm text-zinc-300 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-zinc-100"
					onchange={(e) => (chosen = e.currentTarget.files?.[0] ?? null)}
				/>
			</label>
			{#if chosen && data.canRead}
				<button
					type="button"
					class="{button} bg-zinc-800 hover:bg-zinc-700"
					disabled={reading}
					onclick={readInvoice}>{reading ? 'Leyendo…' : '✨ Leer la factura'}</button
				>
				<span class="text-xs text-zinc-500">Rellena lo de arriba con lo que pone: revísalo.</span>
			{/if}
			{#if draft.hasDocument}
				<label class="flex items-center gap-2 text-xs text-zinc-400">
					<input type="checkbox" name="quitarFactura" class="rounded" /> Quitar la factura
				</label>
			{/if}
			<div class="flex w-full gap-2">
				<button class="{button} bg-amber-500 font-medium text-zinc-950 hover:bg-amber-400">
					Guardar
				</button>
				<button
					type="button"
					class="{button} text-zinc-400 hover:bg-zinc-800"
					onclick={() => (draft = null)}>Cancelar</button
				>
			</div>
			{#if problem}<p class="w-full text-sm text-red-400">{problem}</p>{/if}
		</form>
	{:else}
		<!-- The same three as in Gastos, in the same order. -->
		<div class="mb-6 flex flex-wrap gap-2">
			{#if data.canRead}
				<label
					class="cursor-pointer rounded-md bg-amber-500 px-4 py-2 font-semibold text-zinc-950 hover:bg-amber-400"
				>
					📷 Foto
					<input
						type="file"
						accept="image/*"
						capture="environment"
						class="hidden"
						onchange={(e) => fromDocument(e.currentTarget)}
					/>
				</label>
				<label class="cursor-pointer rounded-md bg-zinc-800 px-4 py-2 hover:bg-zinc-700">
					📄 Factura
					<!-- Only PDF: with images too, Android offers the camera and no files. -->
					<input
						type="file"
						accept="application/pdf,.pdf"
						class="hidden"
						onchange={(e) => fromDocument(e.currentTarget)}
					/>
				</label>
			{/if}
			<button class="rounded-md bg-zinc-800 px-4 py-2 hover:bg-zinc-700" onclick={newOne}
				>+ A mano</button
			>
		</div>
	{/if}

	<ul class="mb-10 divide-y divide-zinc-800">
		{#each data.incomes as i (i.id)}
			<!-- On a phone, in two lines: what it was and how much, and under them what can be done. -->
			<li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
				<span class="w-14 shrink-0 self-start text-sm text-zinc-400 sm:self-center"
					>{day(i.date)}</span
				>
				<span class="min-w-0 flex-1">
					<span class="block break-words sm:truncate">{i.concept}</span>
					<span class="block text-xs text-zinc-500"
						>{i.category}{#if i.by}
							· {i.by}{/if}</span
					>
				</span>
				<span
					class="shrink-0 self-start text-right text-emerald-400 tabular-nums sm:order-1 sm:self-center"
					>{euros(i.amount)}</span
				>
				<span class="flex w-full items-center justify-end gap-1 sm:contents">
					{#if i.document}
						<a
							href="/gastos/ingresos/{i.id}/factura"
							target="_blank"
							rel="noreferrer"
							class="mr-auto shrink-0 text-sm text-amber-400 hover:underline sm:mr-0"
							title="Ver la factura">{i.document === 'pdf' ? '📄' : '🖼️'} Factura</a
						>
					{/if}
					<button
						class="{button} px-2 text-zinc-400 hover:bg-zinc-800 sm:order-2"
						aria-label="Cambiar {i.concept}"
						title="Cambiar"
						onclick={() => edit(i)}>✎</button
					>
					<button
						class="{button} px-2 text-zinc-400 hover:bg-zinc-800 hover:text-red-400 sm:order-2"
						aria-label="Borrar {i.concept}"
						title="Borrar"
						onclick={() => (deleting = i.id)}>✕</button
					>
				</span>
			</li>
			{#if deleting === i.id}
				<li class="py-2">
					<form method="post" action="?/delete" use:enhance class="flex items-center gap-2">
						<input type="hidden" name="id" value={i.id} />
						<span class="text-sm">¿Borrar «{i.concept}»{i.document ? ' y su factura' : ''}?</span>
						<button class="{button} bg-red-700 hover:bg-red-600">Sí</button>
						<button
							type="button"
							class="{button} hover:bg-zinc-800"
							onclick={() => (deleting = null)}>No</button
						>
					</form>
				</li>
			{/if}
		{:else}
			<li class="py-4 text-zinc-400">Ningún ingreso apuntado este mes.</li>
		{/each}
	</ul>
	{#if form && 'message' in form && !draft}
		<p class="text-sm text-red-400">{form.message}</p>
	{/if}
</div>
