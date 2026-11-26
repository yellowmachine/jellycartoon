<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import { page } from '$app/state';
	import ConfirmForm from 'comun/components/ConfirmForm.svelte';
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import { euros, MONTH_NAMES, monthOf } from 'comun/expenses.ts';
	import { wishesOf } from '#lib/summary.ts';
	import Juntos from './Juntos.svelte';
	import Comprado from './Comprado.svelte';
	import { field, primary, secondary, select } from '#lib/styles.ts';
	import {
		amountField,
		bookmarklet,
		MAX_WISH_NOTE,
		MAX_WISH_TITLE,
		priceChangeText,
		costText,
		shippingField,
		readPriceChange,
		seenOn,
		WISH_PRIORITIES,
		WISH_PRIORITY_LABELS,
		wishesSummary
	} from '#lib/wishes.ts';
	import type { PageProps } from './$types';

	/**
	 * Lista de deseos (#586): each person's, from any shop, filtered by person and by shop. «Lo regalo
	 * yo» for someone else's, never shown to the person it is for.
	 */
	let { data, form }: PageProps = $props();

	const chosenPerson = $derived(page.url.searchParams.get('persona'));
	const chosenShop = $derived(page.url.searchParams.get('tienda'));
	const writable = $derived(data.people.filter((p) => p.writes));
	const nameOf = (id: string) => {
		const p = data.people.find((x) => x.id === id);
		return p ? (p.me ? 'Tú' : p.name) : '';
	};

	const ofPerson = $derived(
		data.wishes.filter((w) => !chosenPerson || w.personId === chosenPerson)
	);
	/** The shops in what is shown, with how many each, the one with most first. */
	const shops = $derived.by(() => {
		const count = new Map<string, number>();
		for (const w of ofPerson) count.set(w.shop, (count.get(w.shop) ?? 0) + 1);
		return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'));
	});
	const filtered = $derived(ofPerson.filter((w) => !chosenShop || w.shop === chosenShop));
	const shown = $derived(filtered.filter((w) => !w.bought));
	/** By when each is for, those with any; titled only if some is not the usual «Pronto». */
	const sections = $derived(
		WISH_PRIORITIES.map((priority) => ({
			priority,
			list: shown.filter((w) => w.priority === priority)
		})).filter((s) => s.list.length)
	);
	const titled = $derived(sections.some((s) => s.priority !== 'pronto'));
	const bought = $derived(
		filtered
			.filter((w) => w.bought)
			.sort((a, b) => (b.bought?.on ?? '').localeCompare(a.bought?.on ?? ''))
	);
	/** Just said «Comprado»: told so, with its expense in Dinero if put in. */
	let justBought = $state<{ expense: number | null; month: string } | null>(null);

	/** This page with what is chosen now, but for what changes; the bought ones' period too (#631). */
	const link = (change: {
		persona?: string | null;
		tienda?: string | null;
		comprados?: string | null;
		buscar?: string | null;
	}) => {
		const chosen = {
			persona: chosenPerson,
			tienda: chosenShop,
			comprados: page.url.searchParams.get('comprados'),
			buscar: page.url.searchParams.get('buscar'),
			...change
		};
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(chosen)) if (value) params.set(key, value);
		const query = `${params}`;
		return query ? `?${query}` : page.url.pathname;
	};

	/** The bought ones (#631): of a year or a month, or found by words in any. */
	const period = $derived(data.bought.period);
	const year = $derived(period?.slice(0, 4) ?? data.today.slice(0, 4));
	const years = $derived(
		[
			...new Set([data.today.slice(0, 4), ...data.bought.months.map((m) => m.month.slice(0, 4))])
		].sort()
	);
	const olderYear = $derived(years.filter((y) => y < year).at(-1) ?? null);
	const newerYear = $derived(years.find((y) => y > year) ?? null);
	const yearMonths = $derived(data.bought.months.filter((m) => m.month.startsWith(year)));
	const monthName = (month: string) => MONTH_NAMES[Number(month.slice(5, 7)) - 1]!.toLowerCase();
	const periodText = $derived(
		!period ? '' : period.length === 4 ? `en ${period}` : `en ${monthName(period)} de ${year}`
	);
	/** Each expense in Dinero once, as the Resumen: several bought together are one. */
	const spent = $derived(
		data.kid
			? null
			: wishesOf(
					bought.flatMap((w) =>
						w.bought
							? [
									{
										id: w.id,
										title: w.title,
										person: '',
										shop: w.shop,
										on: w.bought.on,
										priceCents: w.priceCents,
										shippingCents: w.shippingCents,
										extraCents: w.extraCents,
										currency: w.currency,
										expenseId: w.bought.expenseId
									}
								]
							: []
					),
					new Map(Object.entries(data.bought.totals).map(([id, t]) => [Number(id), t]))
				)
	);
	const boughtOpen = $derived(
		page.url.searchParams.has('comprados') ||
			page.url.searchParams.has('buscar') ||
			bought.some((w) => w.id === shownAlready)
	);

	const chip = (on: boolean) =>
		`rounded-full px-3 py-1 text-sm ${on ? 'bg-amber-500 font-medium text-zinc-950' : 'bg-zinc-800 hover:bg-zinc-700'}`;

	let adding = $state(false);
	let address = $state('');
	let forWhom = $state('');
	$effect(() => {
		if (!forWhom || !writable.some((p) => p.id === forWhom))
			forWhom =
				(chosenPerson && writable.find((p) => p.id === chosenPerson)?.id) ??
				writable.find((p) => p.me)?.id ??
				writable[0]?.id ??
				'';
	});
	/** Saved without resetting the form: its select keeps what was chosen. */
	const keepForm: SubmitFunction =
		() =>
		async ({ update }) =>
			update({ reset: false });
	let editing = $state<number | null>(null);

	// ——— «Seleccionar»: to see what some cost together, or to do one thing to all ———

	let selecting = $state(false);
	/** «Marcar como comprados» open, with what is paid. */
	let together = $state(false);
	const selected = new SvelteSet<number>();
	function setSelecting(on: boolean) {
		selecting = on;
		selected.clear();
		op = '';
		editing = null;
		together = false;
	}
	const picked = (list: typeof shown) => list.filter((w) => selected.has(w.id));
	/** Only those shown: what a filter hides is not counted, nor touched. */
	const picks = $derived(picked(shown));
	const writesOf = (w: (typeof shown)[number]) =>
		data.people.some((p) => p.id === w.personId && p.writes);
	const isMine = (w: (typeof shown)[number]) =>
		data.people.some((p) => p.id === w.personId && p.me);
	/** Which of them each thing can be done to. */
	const canWrite = $derived(picks.filter(writesOf));
	const canBuy = $derived(picks.filter((w) => w.buys));
	const canGive = $derived(data.kid ? [] : picks.filter((w) => !isMine(w) && !w.gift));
	/** What is chosen to do, and the ones it is done to. */
	let op = $state('');
	const targets = $derived(
		op === 'regalar' ? canGive : op === 'comprar' ? canBuy : op ? canWrite : []
	);
	const idsOf = (list: typeof shown) => list.map((w) => w.id).join(',');
	const summary = (list: typeof shown) =>
		selecting ? wishesSummary(picked(list), list.length) : wishesSummary(list);
	const bulk: SubmitFunction = () => {
		problem = null;
		return async ({ result, update }) => {
			await update({ reset: false });
			op = '';
			if (result.type === 'success') selected.clear();
			// Some done, some not: the list as it is now.
			else await refreshAll();
		};
	};
	let problem = $state<string | null>(null);

	// ——— What is added elsewhere (the bookmark, the family), here at once ———

	/** The wish whose «Marcar como comprado» is open. */
	let buying = $state<number | null>(null);
	/** Changed since it was last loaded. */
	let stale = $state(false);
	/** Something half done here, that a list moving under it would spoil: it waits. */
	const busy = $derived(editing !== null || selecting || buying !== null || adding);
	$effect(() => {
		if (!stale || busy) return;
		// Several changes at once («Seleccionar») are loaded once.
		const timer = setTimeout(() => {
			stale = false;
			void refreshAll().catch(() => {});
		}, 200);
		return () => clearTimeout(timer);
	});
	$effect(() => {
		let events: EventSource | undefined;
		let opened = false;
		let hiddenAt = 0;
		function connect() {
			events?.close();
			events = new EventSource('/api/deseos/events');
			events.onmessage = () => (stale = true);
			// Again, after a cut: what changed meanwhile was not told.
			events.onopen = () => {
				if (opened) stale = true;
				opened = true;
			};
		}
		// A phone may cut it, or leave it dead, while the page is hidden.
		function onVisible() {
			if (document.hidden) hiddenAt = Date.now();
			else if (events?.readyState === EventSource.CLOSED || Date.now() - hiddenAt > 60_000)
				connect();
		}
		connect();
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			document.removeEventListener('visibilitychange', onVisible);
			events?.close();
		};
	});
	/** The one that was already there when the same product was added again (#586). */
	let already = $state<number | null>(null);
	/** And what that did to its price, in words; shared, from the address. */
	let change = $state<string | null>(null);
	const sharedChange = $derived(readPriceChange(page.url.searchParams.get('precio')));
	const shownAlready = $derived(already ?? (Number(page.url.searchParams.get('ya')) || null));
	$effect(() => {
		if (shownAlready)
			document.getElementById(`deseo-${shownAlready}`)?.scrollIntoView({ block: 'center' });
	});
</script>

{#snippet keep()}
	{#if chosenPerson}<input type="hidden" name="persona" value={chosenPerson} />{/if}
	{#if chosenShop}<input type="hidden" name="tienda" value={chosenShop} />{/if}
{/snippet}

{#snippet act(what: string, label: string, list: PageProps['data']['wishes'])}
	<form method="post" action="?/bulk" use:enhance={bulk}>
		<input type="hidden" name="ids" value={idsOf(list)} />
		<button name="op" value={what} class={secondary}>{label}</button>
	</form>
{/snippet}

{#snippet all(list: PageProps['data']['wishes'])}
	{#if selecting}
		{@const every = list.every((w) => selected.has(w.id))}
		<button
			type="button"
			class="mb-3 text-sm text-amber-400 hover:underline"
			onclick={() => {
				for (const w of list)
					if (every) selected.delete(w.id);
					else selected.add(w.id);
			}}>{every ? 'Ninguno' : 'Todos'}</button
		>
	{/if}
{/snippet}

{#snippet cards(list: PageProps['data']['wishes'])}
	<ul class="grid gap-4 sm:grid-cols-2">
		{#each list as w (w.id)}
			{@const price = costText(w)}
			{@const writes = data.people.some((p) => p.id === w.personId && p.writes)}
			{@const forMe = data.people.some((p) => p.id === w.personId && p.me)}
			<li
				id="deseo-{w.id}"
				class="relative flex gap-3 rounded-lg border bg-zinc-900 p-3 {shownAlready === w.id ||
				(selecting && selected.has(w.id))
					? 'border-amber-500'
					: w.priority === 'primero'
						? 'border-amber-500/50'
						: 'border-zinc-800'}"
			>
				{#if selecting}
					<!-- The whole card is the checkbox; what is under it, out of reach meanwhile. -->
					<label class="absolute inset-0 z-10 cursor-pointer rounded-lg p-2 text-right">
						<input
							type="checkbox"
							checked={selected.has(w.id)}
							onchange={(e) =>
								e.currentTarget.checked ? selected.add(w.id) : selected.delete(w.id)}
							class="h-5 w-5 rounded border-zinc-500 bg-zinc-950 text-amber-500 focus:ring-amber-400"
						/>
						<span class="sr-only">{w.title}{price ? `, ${price}` : ''}</span>
					</label>
				{/if}
				<a
					href={w.url}
					inert={selecting}
					target="_blank"
					rel="noopener noreferrer"
					class="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-claro"
					tabindex="-1"
					aria-hidden="true"
				>
					{#if w.imageUrl}
						<img
							src={w.imageUrl}
							alt=""
							loading="lazy"
							referrerpolicy="no-referrer"
							class="h-full w-full object-contain"
						/>
					{:else}
						<SectionIcon name="deseos" class="h-10 w-10 text-zinc-400" />
					{/if}
				</a>
				<div class="min-w-0 flex-1" class:pr-6={selecting} inert={selecting}>
					{#if editing === w.id}
						<form
							method="post"
							action="?/update"
							class="flex flex-col gap-2"
							use:enhance={() =>
								async ({ result, update }) => {
									if (result.type === 'success') editing = null;
									await update({ reset: false });
								}}
						>
							<input type="hidden" name="id" value={w.id} />
							<input
								name="title"
								value={w.title}
								required
								maxlength={MAX_WISH_TITLE}
								aria-label="Nombre"
								class="{field} py-1 text-sm"
							/>
							<input
								name="note"
								value={w.note ?? ''}
								maxlength={MAX_WISH_NOTE}
								placeholder="Talla, color…"
								aria-label="Nota"
								class="{field} py-1 text-sm"
							/>
							<input type="hidden" name="currency" value={w.currency ?? ''} />
							<div class="grid grid-cols-3 items-end gap-2">
								<label class="text-xs text-zinc-400"
									>Precio
									<input
										name="price"
										value={w.priceCents === null
											? ''
											: (w.priceCents / 100).toFixed(2).replace('.', ',')}
										inputmode="decimal"
										maxlength="20"
										placeholder="12,30"
										aria-label="Precio{w.currency && w.currency !== 'EUR'
											? ` (${w.currency})`
											: ''}"
										class="{field} mt-1 px-2 py-1 text-sm"
									/>
								</label>
								<label class="text-xs text-zinc-400"
									>Envío
									<input
										name="shipping"
										value={shippingField(w.shippingCents)}
										maxlength="20"
										placeholder="o gratis"
										aria-label="Envío{w.currency && w.currency !== 'EUR' ? ` (${w.currency})` : ''}"
										class="{field} mt-1 px-2 py-1 text-sm"
									/>
								</label>
								<label class="text-xs text-zinc-400"
									>IVA y otros
									<input
										name="extra"
										value={amountField(w.extraCents)}
										maxlength="20"
										placeholder="1,34 o 4 %"
										title="Lo que la tienda añade al final: IVA, aduanas… Un porcentaje, sobre el precio con su envío"
										aria-label="IVA y otros que añade la tienda al final{w.currency &&
										w.currency !== 'EUR'
											? ` (${w.currency})`
											: ''}"
										class="{field} mt-1 px-2 py-1 text-sm"
									/>
								</label>
							</div>
							<div class="flex gap-2">
								<button class={primary}>Guardar</button>
								<button type="button" class={secondary} onclick={() => (editing = null)}
									>Cancelar</button
								>
							</div>
						</form>
					{:else}
						<a
							href={w.url}
							target="_blank"
							rel="noopener noreferrer"
							class="line-clamp-2 font-medium hover:underline">{w.title}</a
						>
						<p class="text-sm text-zinc-400">
							{w.shop}{#if price}{' · '}<span class="text-zinc-200">{price}</span
								>{#if seenOn(w.priceAt)}{' '}<span class="text-xs">{seenOn(w.priceAt)}</span
									>{/if}{/if}{#if !chosenPerson && data.people.length > 1}{` · ${nameOf(w.personId)}`}{/if}
						</p>
						{#if w.note}<p class="text-sm text-zinc-300">{w.note}</p>{/if}
						<div
							class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
							class:hidden={selecting}
						>
							{#if w.gift?.mine}
								<span class="text-emerald-400">Lo regalas tú</span>
								<form method="post" action="?/give" use:enhance>
									<input type="hidden" name="id" value={w.id} />
									<button class="text-zinc-400 hover:underline">Ya no</button>
								</form>
							{:else if w.gift}
								<span class="text-zinc-400">Lo regala {w.gift.name}</span>
							{:else if !forMe && !data.kid}
								<form method="post" action="?/give" use:enhance>
									<input type="hidden" name="id" value={w.id} />
									<input type="hidden" name="on" value="1" />
									<button class="text-amber-400 hover:underline">Lo regalo yo</button>
								</form>
							{/if}
							{#if w.buys}
								<Comprado
									wish={w}
									today={data.today}
									secret={!forMe && !writes}
									onopen={(open) => (buying = open ? w.id : buying === w.id ? null : buying)}
									onbought={(done) => (justBought = done)}
								/>
							{/if}
							{#if writes}
								<form method="post" action="?/priority" use:enhance={keepForm}>
									<input type="hidden" name="id" value={w.id} />
									<select
										name="priority"
										value={w.priority}
										aria-label="Para cuándo"
										class="rounded-md border-0 bg-transparent py-1 pr-7 pl-0 text-sm text-zinc-400 hover:underline focus:ring-amber-400"
										onchange={(e) => e.currentTarget.form?.requestSubmit()}
									>
										{#each WISH_PRIORITIES as p (p)}
											<option value={p} class="bg-zinc-900">{WISH_PRIORITY_LABELS[p]}</option>
										{/each}
									</select>
								</form>
								<button class="text-zinc-400 hover:underline" onclick={() => (editing = w.id)}
									>Editar</button
								>
								<ConfirmForm
									action="?/delete"
									fields={{ id: w.id }}
									label="Quitar"
									question="¿Quitar de la lista?"
									yes="Sí, quitar"
									class="text-zinc-400 hover:underline"
								/>
							{/if}
						</div>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
{/snippet}

<svelte:head><title>Deseos</title></svelte:head>

<h1 class="mb-1 flex items-center gap-2 text-2xl font-bold">
	<SectionIcon name="deseos" class="h-7 w-7" />Deseos
</h1>
<p class="mb-6 text-sm text-zinc-400">
	{#if data.kid}
		Lo que te gustaría. Comparte el enlace de una tienda o pégalo aquí.
	{:else}
		Lo que le gustaría a cada uno, de cualquier tienda: comparte el enlace desde el móvil o pégalo
		aquí. Lo ve toda la familia; quién lo regala, no lo ve a quien es el regalo.
	{/if}
</p>

{#if writable.length}
	<form
		method="post"
		action="?/add"
		class="mb-6 flex flex-wrap items-end gap-2"
		use:enhance={() => {
			adding = true;
			problem = null;
			return async ({ result, update }) => {
				adding = false;
				already = null;
				change = null;
				if (result.type === 'failure') {
					problem = String(result.data?.message ?? 'No se pudo añadir');
					if (typeof result.data?.already === 'number') already = result.data.already;
					change = typeof result.data?.change === 'string' ? result.data.change : null;
				} else if (result.type === 'error') problem = 'No se pudo añadir';
				else address = '';
				await update({ reset: false });
				// Its price may be another now: a failure does not bring the list again.
				if (change) await refreshAll();
			};
		}}
	>
		<label class="min-w-56 flex-1 text-xs text-zinc-400">
			Enlace del producto
			<input
				name="url"
				type="url"
				required
				bind:value={address}
				placeholder="https://…"
				class="{field} mt-1 py-1.5 text-sm"
			/>
		</label>
		{#if writable.length > 1}
			<label class="text-xs text-zinc-400">
				Para
				<select name="persona" bind:value={forWhom} class="{select} mt-1 block">
					{#each writable as p (p.id)}
						<option value={p.id}>{p.me ? 'Mí' : p.name}</option>
					{/each}
				</select>
			</label>
		{:else}
			<input type="hidden" name="persona" value={forWhom} />
		{/if}
		<button class={primary} disabled={adding}>{adding ? 'Leyendo la página…' : 'Añadir'}</button>
	</form>
{/if}
{#if shownAlready && !problem}
	<p class="mb-4 text-sm text-amber-300" role="status">
		Ya estaba en la lista: es este{sharedChange ? `, ${priceChangeText(sharedChange)}` : ''}.
	</p>
{:else if problem ?? form?.message}
	<p class="mb-4 text-sm {already ? 'text-amber-300' : 'text-red-400'}" role="alert">
		{problem ?? form?.message}{already ? `: es este${change ? `, ${change}` : ''}.` : ''}
	</p>
{/if}

{#if data.people.length > 1}
	<nav class="mb-3 flex flex-wrap gap-2" aria-label="Persona">
		<a href={link({ persona: null, tienda: null })} class={chip(!chosenPerson)}>Todos</a>
		{#each data.people as p (p.id)}
			<a
				href={link({ persona: p.id, tienda: null })}
				class={chip(chosenPerson === p.id)}
				aria-current={chosenPerson === p.id ? 'true' : undefined}
				>{p.emoji ? `${p.emoji} ` : ''}{p.me ? 'Tú' : p.name}</a
			>
		{/each}
	</nav>
{/if}

{#if shops.length > 1}
	<nav class="mb-6 flex flex-wrap gap-2" aria-label="Tienda">
		<a href={link({ tienda: null })} class={chip(!chosenShop)}>Todas las tiendas</a>
		{#each shops as [shop, n] (shop)}
			<a
				href={link({ tienda: shop })}
				class={chip(chosenShop === shop)}
				aria-current={chosenShop === shop ? 'true' : undefined}
				>{shop} <span class="opacity-70">{n}</span></a
			>
		{/each}
	</nav>
{/if}

{#if shown.length}
	<div class="mb-4 flex justify-end">
		<button
			type="button"
			class={secondary}
			aria-pressed={selecting}
			onclick={() => setSelecting(!selecting)}
			>{selecting ? 'Dejar de seleccionar' : 'Seleccionar'}</button
		>
	</div>
{/if}

{#if justBought}
	<p class="mb-4 text-sm text-emerald-400" role="status">
		{#if justBought.expense}
			Comprado y añadido a Dinero.
			<a
				href="/gastos?mes={justBought.month}&gasto={justBought.expense}"
				class="text-amber-400 hover:underline">Ver el gasto</a
			>
		{:else}
			Marcado como comprado.
		{/if}
	</p>
{/if}

{#if !shown.length}
	<p class="mt-6 text-zinc-400">
		{#if bought.length}
			Nada por comprar aquí.
		{:else if chosenShop}
			Nada de {chosenShop} aquí.
		{:else if chosenPerson}
			Su lista está vacía.
		{:else}
			Todavía no hay deseos. Comparte el enlace de un producto con Seilide desde el móvil, o pégalo
			arriba.
		{/if}
	</p>
{:else}
	{#each sections as s (s.priority)}
		{#if !titled}
			<p class="mb-3 text-sm text-zinc-400">{summary(s.list)}</p>
			{@render all(s.list)}
			{@render cards(s.list)}
		{:else if s.priority === 'mas_adelante'}
			<!-- Folded, unless there is nothing else, or the one looked for is in it. -->
			<details
				class="mt-8"
				open={sections.length === 1 || s.list.some((w) => w.id === shownAlready)}
			>
				<summary class="cursor-pointer font-semibold">
					{WISH_PRIORITY_LABELS[s.priority]}
					<span class="text-sm font-normal text-zinc-400">{summary(s.list)}</span>
				</summary>
				<div class="mt-3">
					{@render all(s.list)}
					{@render cards(s.list)}
				</div>
			</details>
		{:else}
			<section class="mt-6 first:mt-0">
				<h2 class="mb-3 font-semibold">
					{WISH_PRIORITY_LABELS[s.priority]}
					<span class="text-sm font-normal text-zinc-400">{summary(s.list)}</span>
				</h2>
				{@render all(s.list)}
				{@render cards(s.list)}
			</section>
		{/if}
	{/each}
{/if}

{#if selecting && shown.length}
	<!-- Over the cards while choosing. Room at its right for the call button (#330). -->
	<div
		class="sticky bottom-0 z-20 mt-6 rounded-t-lg border border-b-0 border-zinc-700 bg-zinc-900 py-3 pr-20 pl-4"
	>
		<p class="mb-2 font-semibold tabular-nums" role="status">
			{wishesSummary(picks, shown.length)}
		</p>
		{#if form?.message && !problem}
			<p class="mb-2 text-sm text-red-400" role="alert">{form.message}</p>
		{/if}
		{#if together && canBuy.length}
			<Juntos
				list={canBuy}
				today={data.today}
				secret={canBuy.some((w) => !isMine(w) && !writesOf(w))}
				onbought={(done) => {
					justBought = done;
					setSelecting(false);
				}}
				oncancel={() => (together = false)}
			/>
		{:else if picks.length && (canWrite.length || canGive.length || canBuy.length)}
			<!-- With room, each thing in sight; on a phone, in one menu. -->
			<div class="hidden flex-wrap items-center gap-2 text-sm sm:flex">
				{#if canWrite.length}
					<span class="text-zinc-400">Para cuándo ({canWrite.length}):</span>
					{#each WISH_PRIORITIES as p (p)}
						{@render act(p, WISH_PRIORITY_LABELS[p], canWrite)}
					{/each}
				{/if}
				{#if canGive.length}
					{@render act('regalar', `Los regalo yo (${canGive.length})`, canGive)}
				{/if}
				{#if canBuy.length}
					<button type="button" class={secondary} onclick={() => (together = true)}
						>Marcar como comprados ({canBuy.length})</button
					>
				{/if}
				{#if canWrite.length}
					<ConfirmForm
						action="?/bulk"
						fields={{ ids: idsOf(canWrite), op: 'quitar' }}
						label="Quitar ({canWrite.length})"
						question="¿Quitar {canWrite.length} de la lista?"
						yes="Sí, quitar"
						class="rounded-md border border-red-900 px-3 py-1 text-sm text-red-300 hover:bg-red-950"
					/>
				{/if}
			</div>
			<form
				method="post"
				action="?/bulk"
				use:enhance={(form) => {
					if (op === 'comprar') {
						form.cancel();
						op = '';
						together = true;
						return;
					}
					return bulk(form);
				}}
				class="flex items-center gap-2 text-sm sm:hidden"
			>
				<input type="hidden" name="ids" value={idsOf(targets)} />
				<select
					name="op"
					bind:value={op}
					aria-label="Qué hacer con lo seleccionado"
					class="{select} min-w-0 flex-1 sm:max-w-64"
				>
					<option value="">Hacer con ellos…</option>
					{#if canWrite.length}
						<optgroup label="Para cuándo">
							{#each WISH_PRIORITIES as p (p)}
								<option value={p}>{WISH_PRIORITY_LABELS[p]} ({canWrite.length})</option>
							{/each}
						</optgroup>
					{/if}
					{#if canGive.length}
						<option value="regalar">Los regalo yo ({canGive.length})</option>
					{/if}
					{#if canBuy.length}
						<option value="comprar">Marcar como comprados ({canBuy.length})</option>
					{/if}
					{#if canWrite.length}
						<option value="quitar">Quitar de la lista ({canWrite.length})</option>
					{/if}
				</select>
				{#if op && targets.length}
					<button
						class={op === 'quitar'
							? 'shrink-0 rounded-md bg-red-700 px-3 py-1 font-medium hover:bg-red-600'
							: `${primary} shrink-0`}
						>{op === 'quitar' ? `Sí, quitar ${targets.length}` : 'Aplicar'}</button
					>
				{/if}
			</form>
		{/if}
	</div>
{/if}

{#if bought.length || data.bought.months.length || data.bought.search}
	<!-- Choosing a year, a month or words stays here, at the end of the page. -->
	<details class="mt-8" open={boughtOpen} data-sveltekit-noscroll>
		<summary class="cursor-pointer font-semibold">
			Comprados <span class="text-zinc-400">{period ? periodText : 'buscando'}</span>
		</summary>
		<div class="mt-3 flex flex-wrap items-center gap-2 text-sm">
			{#if !data.bought.search}
				<span class="flex items-center gap-1">
					{#if olderYear}<a
							href={link({ comprados: olderYear })}
							class="rounded-md border border-zinc-700 px-2 py-1 hover:bg-zinc-800"
							aria-label="Año anterior, {olderYear}">‹</a
						>{/if}
					<span class="px-1 font-medium tabular-nums">{year}</span>
					{#if newerYear}<a
							href={link({ comprados: newerYear })}
							class="rounded-md border border-zinc-700 px-2 py-1 hover:bg-zinc-800"
							aria-label="Año siguiente, {newerYear}">›</a
						>{/if}
				</span>
				<form method="get">
					{@render keep()}
					<select
						name="comprados"
						aria-label="Mes"
						class={select}
						value={period}
						onchange={(e) => e.currentTarget.form?.requestSubmit()}
					>
						<option value={year}>Todo el año</option>
						{#each yearMonths as m (m.month)}
							<option value={m.month}>{monthName(m.month)} ({m.count})</option>
						{/each}
					</select>
				</form>
			{/if}
			<form method="get" class="flex min-w-48 flex-1 gap-2" role="search">
				{@render keep()}
				<input
					type="search"
					name="buscar"
					value={data.bought.search ?? ''}
					placeholder="Buscar en todos los años…"
					aria-label="Buscar en los comprados: título o tienda"
					class="{field} min-w-0 flex-1"
				/>
				<button class={secondary}>Buscar</button>
			</form>
			{#if data.bought.search}
				<a href={link({ buscar: null })} class="text-amber-400 hover:underline"
					>Quitar la búsqueda</a
				>
			{/if}
		</div>
		<p class="mt-2 text-sm text-zinc-400" role="status">
			{bought.length === 1 ? '1 comprado' : `${bought.length} comprados`}{spent
				? ` · ${euros(spent.total)}${spent.unknown ? ` (${spent.unknown} sin precio, no cuentan)` : ''}`
				: ''}{data.bought.search ? ` con «${data.bought.search}»` : ''}
		</p>
		{#if !bought.length}
			<p class="mt-2 text-sm text-zinc-400">
				{data.bought.search ? 'Nada comprado con esas palabras.' : `Nada comprado ${periodText}.`}
			</p>
		{/if}
		<ul class="mt-3 divide-y divide-zinc-800 rounded-lg border border-zinc-800">
			{#each bought as w (w.id)}
				{#if w.bought}
					<li id="deseo-{w.id}" class="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
						<div class="min-w-40 flex-1">
							<a
								href={w.url}
								target="_blank"
								rel="noopener noreferrer"
								class="line-clamp-2 hover:underline">{w.title}</a
							>
							<p class="text-zinc-400">
								{w.shop} · {nameOf(w.personId)} · comprado {seenOn(`${w.bought.on}T12:00:00`)}
								{w.bought.mine ? 'por ti' : `por ${w.bought.name}`}
							</p>
						</div>
						{#if w.bought.expenseId && !data.kid}
							<a
								href="/gastos?mes={monthOf(w.bought.on)}&gasto={w.bought.expenseId}"
								class="text-amber-400 hover:underline">Ver el gasto</a
							>
						{/if}
						{#if w.bought.mine}
							<form
								method="post"
								action="?/unbuy"
								use:enhance={() => {
									justBought = null;
									return async ({ update }) => update();
								}}
							>
								<input type="hidden" name="id" value={w.id} />
								<button
									class="text-zinc-400 hover:underline"
									title={w.bought.expenseId
										? 'Vuelve a la lista; el gasto sigue en Dinero'
										: 'Vuelve a la lista'}>Deshacer</button
								>
							</form>
						{/if}
						{#if data.people.some((p) => p.id === w.personId && p.writes)}
							<ConfirmForm
								action="?/delete"
								fields={{ id: w.id }}
								label="Quitar"
								question="¿Quitar de la lista?"
								yes="Sí, quitar"
								class="text-zinc-400 hover:underline"
							/>
						{/if}
					</li>
				{/if}
			{/each}
		</ul>
	</details>
{/if}

{#if writable.length}
	<!-- The computer's bookmark (#586): on a phone, sharing from the shop's app does it. -->
	<section id="marcador" class="mt-10 hidden rounded-md border border-zinc-800 p-4 sm:block">
		<h2 class="mb-1 font-semibold">En el ordenador</h2>
		<p class="mb-3 text-sm text-zinc-400">
			Arrastra este botón a la barra de marcadores. En la página de un producto de cualquier tienda,
			púlsalo: tu navegador lee el nombre, la foto, el precio (también en Amazon) y el envío, si la
			tienda lo dice, y te lo trae aquí.
		</p>
		<!-- Its text is the bookmark's name: a bookmark of code has no icon of its own, so the emoji
		is what tells it apart in the bar. -->
		<a
			href={bookmarklet(page.url.origin)}
			class="inline-flex items-center rounded-md border border-amber-500/60 px-3 py-1.5 text-sm font-medium text-amber-300"
			onclick={(e) => e.preventDefault()}
			title="Arrástralo a la barra de marcadores">🎁 Deseos</a
		>
		<!-- What any bookmark of code may do, this one or another site's: said before it is dragged. -->
		<div
			class="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-zinc-300"
			role="note"
		>
			<p class="mb-2 font-semibold text-amber-300">
				Antes de arrastrar un marcador, este o el de cualquier web
			</p>
			<ul class="list-disc space-y-1 pl-5">
				<li>
					Un marcador así es código: al pulsarlo se ejecuta dentro de la página que tienes abierta,
					con tu sesión iniciada en ella.
				</li>
				<li>
					Puede leer y cambiar todo lo que ves en esa página, también lo que escribes, y hacer cosas
					en esa web como si fueras tú: en una tienda, ver tus pedidos; en tu banco, lo que veas
					allí.
				</li>
				<li>
					No llega a otras pestañas, ni a tus contraseñas guardadas, ni a tus ficheros, y solo hace
					algo cuando lo pulsas.
				</li>
				<li>
					Arrastra solo marcadores de quien te fíes, y no pegues nunca en el navegador código que te
					pidan en un mensaje o en una web.
				</li>
				<li>
					Este lee el nombre, la foto, el precio, el envío y la dirección del producto y abre
					Seilide con ellos. También recoge el texto visible del producto y las opciones elegidas
					(nunca lo que escribes), que no salen de tu ordenador si no pulsas «Analizar con IA». Su
					código se puede ver con el botón derecho sobre el marcador → Editar.
				</li>
			</ul>
		</div>
	</section>
{/if}
