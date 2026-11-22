<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import ConfirmForm from 'comun/components/ConfirmForm.svelte';
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import { field, primary, secondary, select } from '#lib/styles.ts';
	import { bookmarklet, MAX_WISH_NOTE, MAX_WISH_TITLE, priceText, seenOn } from '#lib/wishes.ts';
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
	const shown = $derived(ofPerson.filter((w) => !chosenShop || w.shop === chosenShop));

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

{#if !shown.length}
	<p class="mt-6 text-zinc-400">
		{#if chosenShop}
			Nada de {chosenShop} aquí.
		{:else if chosenPerson}
			Su lista está vacía.
		{:else}
			Todavía no hay deseos. Comparte el enlace de un producto con Seilide desde el móvil, o pégalo
			arriba.
		{/if}
	</p>
{:else}
	<ul class="grid gap-4 sm:grid-cols-2">
		{#each shown as w (w.id)}
			{@const price = priceText(w.priceCents, w.currency)}
			{@const writes = data.people.some((p) => p.id === w.personId && p.writes)}
			{@const forMe = data.people.some((p) => p.id === w.personId && p.me)}
			<li
				id="deseo-{w.id}"
				class="flex gap-3 rounded-lg border bg-zinc-900 p-3 {shownAlready === w.id
					? 'border-amber-500'
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
							{#if writes}
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
		<a
			href={bookmarklet(page.url.origin)}
			class="inline-flex items-center gap-2 rounded-md border border-amber-500/60 px-3 py-1.5 text-sm font-medium text-amber-300"
			onclick={(e) => e.preventDefault()}
			title="Arrástralo a la barra de marcadores"
			><SectionIcon name="deseos" class="h-4 w-4" />A Deseos</a
		>
	</section>
{/if}
