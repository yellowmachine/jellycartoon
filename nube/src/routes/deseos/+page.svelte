<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { page } from '$app/state';
	import ConfirmForm from 'comun/components/ConfirmForm.svelte';
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import { monthOf } from 'comun/expenses.ts';
	import Comprado from './Comprado.svelte';
	import { field, primary, secondary, select } from '#lib/styles.ts';
	import {
		bookmarklet,
		MAX_WISH_NOTE,
		MAX_WISH_TITLE,
		priceText,
		seenOn,
		WISH_PRIORITIES,
		WISH_PRIORITY_LABELS
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

	/** This page with what is chosen now, but for what changes. */
	const link = (change: { persona?: string | null; tienda?: string | null }) => {
		const chosen = { persona: chosenPerson, tienda: chosenShop, ...change };
		const params = new URLSearchParams();
		if (chosen.persona) params.set('persona', chosen.persona);
		if (chosen.tienda) params.set('tienda', chosen.tienda);
		const query = `${params}`;
		return query ? `?${query}` : page.url.pathname;
	};

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
	let problem = $state<string | null>(null);
	/** The one that was already there when the same product was added again (#586). */
	let already = $state<number | null>(null);
	const shownAlready = $derived(already ?? (Number(page.url.searchParams.get('ya')) || null));
	$effect(() => {
		if (shownAlready)
			document.getElementById(`deseo-${shownAlready}`)?.scrollIntoView({ block: 'center' });
	});
</script>

{#snippet cards(list: PageProps['data']['wishes'])}
	<ul class="grid gap-4 sm:grid-cols-2">
		{#each list as w (w.id)}
			{@const price = priceText(w.priceCents, w.currency)}
			{@const writes = data.people.some((p) => p.id === w.personId && p.writes)}
			{@const forMe = data.people.some((p) => p.id === w.personId && p.me)}
			<li
				id="deseo-{w.id}"
				class="flex gap-3 rounded-lg border bg-zinc-900 p-3 {shownAlready === w.id
					? 'border-amber-500'
					: w.priority === 'primero'
						? 'border-amber-500/50'
						: 'border-zinc-800'}"
			>
				<a
					href={w.url}
					target="_blank"
					rel="noopener noreferrer"
					class="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white"
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
				<div class="min-w-0 flex-1">
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
							{w.shop}{#if price}
								· <span class="text-zinc-200">{price}</span>{#if seenOn(w.priceAt)}
									<span class="text-xs">
										{seenOn(w.priceAt)}</span
									>{/if}{/if}{#if !chosenPerson && data.people.length > 1}
								· {nameOf(w.personId)}{/if}
						</p>
						{#if w.note}<p class="text-sm text-zinc-300">{w.note}</p>{/if}
						<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
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
										class="{select} border-transparent bg-transparent pl-0 text-zinc-400"
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
				if (result.type === 'failure') {
					problem = String(result.data?.message ?? 'No se pudo añadir');
					if (typeof result.data?.already === 'number') already = result.data.already;
				} else if (result.type === 'error') problem = 'No se pudo añadir';
				else address = '';
				await update({ reset: false });
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
	<p class="mb-4 text-sm text-amber-300" role="status">Ya estaba en la lista: es este.</p>
{:else if problem ?? form?.message}
	<p class="mb-4 text-sm {already ? 'text-amber-300' : 'text-red-400'}" role="alert">
		{problem ?? form?.message}{already ? ': es este.' : ''}
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
			{@render cards(s.list)}
		{:else if s.priority === 'mas_adelante'}
			<!-- Folded, unless there is nothing else, or the one looked for is in it. -->
			<details
				class="mt-8"
				open={sections.length === 1 || s.list.some((w) => w.id === shownAlready)}
			>
				<summary class="cursor-pointer font-semibold">
					{WISH_PRIORITY_LABELS[s.priority]} <span class="text-zinc-400">{s.list.length}</span>
				</summary>
				<div class="mt-3">{@render cards(s.list)}</div>
			</details>
		{:else}
			<section class="mt-6 first:mt-0">
				<h2 class="mb-3 font-semibold">{WISH_PRIORITY_LABELS[s.priority]}</h2>
				{@render cards(s.list)}
			</section>
		{/if}
	{/each}
{/if}

{#if bought.length}
	<details class="mt-8" open={bought.some((w) => w.id === shownAlready)}>
		<summary class="cursor-pointer font-semibold">
			Comprados <span class="text-zinc-400">{bought.length}</span>
		</summary>
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
	<section class="mt-10 hidden rounded-md border border-zinc-800 p-4 sm:block">
		<h2 class="mb-1 font-semibold">En el ordenador</h2>
		<p class="mb-3 text-sm text-zinc-400">
			Arrastra este botón a la barra de marcadores. En la página de un producto de cualquier tienda,
			púlsalo: tu navegador lee el nombre, la foto y el precio (también en Amazon) y te lo trae
			aquí.
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
					Este solo lee el nombre, la foto, el precio y la dirección del producto y abre Seilide con
					ellos. Su código se puede ver con el botón derecho sobre el marcador → Editar.
				</li>
			</ul>
		</div>
	</section>
{/if}
