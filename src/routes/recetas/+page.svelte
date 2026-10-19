<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import SectionIcon from '#lib/components/SectionIcon.svelte';
	import { poll } from '#lib/poll.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** Reading the page and preparing its steps: some seconds with the AI. */
	let saving = $state(false);
	/** The search result being saved, by its address. */
	let importing = $state<string | null>(null);
	let addingSite = $state(false);
	/** The site whose name is being changed. */
	let renaming = $state<number | null>(null);

	// A site's map being read: the page follows it.
	$effect(() => {
		if (!data.sites.some((s) => s.indexing)) return;
		return poll(invalidateAll, 3000);
	});

	const day = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
	const small = 'rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-white';
</script>

<svelte:head>
	<title>Recetario · JellyCartoon</title>
</svelte:head>

<h1 class="mb-1 text-2xl font-bold">Recetario</h1>
<p class="mb-4 max-w-2xl text-sm text-zinc-400">
	Las recetas de casa, para cocinarlas paso a paso en la cocina («vamos a hacer los macarrones»). Se
	guardan desde la página de una web de cocina: pega aquí su dirección o, en el móvil, compártela
	desde el navegador con JellyCartoon.
</p>

<form
	method="post"
	action="?/import"
	class="mb-2 flex max-w-2xl gap-2"
	use:enhance={() => {
		saving = true;
		return async ({ update }) => {
			await update({ reset: false });
			saving = false;
		};
	}}
>
	<input
		type="url"
		name="url"
		value={form?.url ?? data.shared ?? ''}
		required
		autocomplete="url"
		placeholder="https://…/receta-de-macarrones"
		aria-label="Dirección de la receta"
		class="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
	/>
	<button
		class="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
		disabled={saving}>{saving ? 'Leyendo la receta…' : 'Guardar'}</button
	>
</form>
{#if form?.error}
	<p class="mb-4 text-sm text-red-400">{form.error}</p>
{:else if data.shared}
	<p class="mb-4 text-sm text-amber-300">Compartida desde el móvil: pulsa «Guardar».</p>
{/if}

<section class="mt-6">
	{#if !data.recipes.length}
		<p class="text-sm text-zinc-400">Todavía no hay ninguna.</p>
	{:else}
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
			{#each data.recipes as r (r.id)}
				<a href="/recetas/{r.id}" class="group min-w-0">
					{#if r.imageUrl}
						<img
							src={r.imageUrl}
							alt=""
							loading="lazy"
							referrerpolicy="no-referrer"
							class="mb-2 aspect-square w-full rounded-md bg-zinc-800 object-cover group-hover:opacity-80"
						/>
					{:else}
						<span
							class="mb-2 flex aspect-square w-full items-center justify-center rounded-md bg-zinc-800 text-zinc-600"
							><SectionIcon name="recetas" class="h-1/3 w-1/3" /></span
						>
					{/if}
					<span class="block truncate text-sm group-hover:text-amber-400">{r.title}</span>
					<span class="block truncate text-xs text-zinc-500">{r.sourceName}</span>
				</a>
			{/each}
		</div>
	{/if}
</section>

{#if data.sites.length}
	<section class="mt-10">
		<h2 class="mb-1 text-lg font-semibold">Buscar en las webs favoritas</h2>
		<p class="mb-3 text-sm text-zinc-400">
			Por las palabras de sus direcciones. También por voz: «busca macarrones gratinados en
			{data.sites[0]!.name}».
		</p>
		<form method="get" class="mb-3 flex max-w-2xl gap-2">
			<input
				type="search"
				name="q"
				value={data.q}
				placeholder="Macarrones gratinados, croquetas…"
				aria-label="Buscar recetas en las webs favoritas"
				class="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
			/>
			<button class="rounded-md bg-zinc-800 px-4 py-2 text-sm hover:bg-zinc-700">Buscar</button>
		</form>
		{#if data.results}
			{#if !data.results.length}
				<p class="text-sm text-zinc-400">No hay ninguna con esas palabras.</p>
			{:else}
				<ul class="max-w-2xl divide-y divide-zinc-800">
					{#each data.results as result (result.url)}
						<li class="flex items-center gap-3 py-2">
							<span class="min-w-0 flex-1">
								<a
									href={result.url}
									target="_blank"
									rel="noreferrer"
									class="block truncate hover:text-amber-400">{result.title}</a
								>
								<span class="block truncate text-xs text-zinc-500">{result.site}</span>
							</span>
							<form
								method="post"
								action="?/import"
								use:enhance={() => {
									importing = result.url;
									return async ({ update }) => {
										await update({ reset: false });
										importing = null;
									};
								}}
							>
								<input type="hidden" name="url" value={result.url} />
								<button
									class="shrink-0 rounded-md border border-zinc-600 px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-50"
									disabled={importing !== null}
									>{importing === result.url ? 'Leyendo…' : 'Guardar'}</button
								>
							</form>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</section>
{/if}

<section class="mt-10 max-w-2xl">
	<h2 class="mb-1 text-lg font-semibold">Webs favoritas</h2>
	<p class="mb-3 text-sm text-zinc-400">
		Webs de cocina donde buscar recetas sin salir de casa: pega cualquier página suya. Se lee su
		mapa (sitemap) y se vuelve a leer cada semana.
	</p>
	<form
		method="post"
		action="?/addSite"
		class="mb-2 flex gap-2"
		use:enhance={() => {
			addingSite = true;
			return async ({ update }) => {
				await update();
				addingSite = false;
			};
		}}
	>
		<input
			type="url"
			name="site"
			value={form?.site ?? ''}
			required
			placeholder="https://…"
			aria-label="Dirección de la web de cocina"
			class="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
		/>
		<button
			class="rounded-md border border-zinc-600 px-4 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50"
			disabled={addingSite}>{addingSite ? 'Añadiendo…' : 'Añadir'}</button
		>
	</form>
	{#if form?.siteError}
		<p class="mb-2 text-sm text-red-400">{form.siteError}</p>
	{/if}
	<ul class="divide-y divide-zinc-800">
		{#each data.sites as site (site.id)}
			<li class="flex items-center gap-3 py-2">
				<span class="min-w-0 flex-1">
					{#if renaming === site.id}
						<form
							method="post"
							action="?/renameSite"
							class="flex gap-2"
							use:enhance={() =>
								async ({ update }) => {
									await update();
									renaming = null;
								}}
						>
							<input type="hidden" name="id" value={site.id} />
							<!-- svelte-ignore a11y_autofocus -->
							<input
								name="name"
								value={site.name}
								required
								maxlength="80"
								autofocus
								aria-label="Nombre de la web"
								onkeydown={(e) => e.key === 'Escape' && (renaming = null)}
								class="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
							/>
							<button class="rounded-md bg-zinc-800 px-3 py-1 text-sm hover:bg-zinc-700"
								>Guardar</button
							>
						</form>
					{:else}
						<span class="block truncate">{site.name}</span>
					{/if}
					<span class="block truncate text-xs text-zinc-500">
						{site.host} ·
						{#if site.indexing}
							<span class="text-amber-400"
								>leyendo su mapa{site.progress?.total
									? `: ${site.progress.done} de ${site.progress.total} · ${site.progress.pages.toLocaleString('es-ES')} páginas`
									: '…'}</span
							>
						{:else if site.lastError}
							<span class="text-amber-400">{site.lastError}</span>
						{:else if site.indexedAt}
							{site.pages} páginas, leído el {day.format(new Date(site.indexedAt))}
						{:else}
							sin leer todavía
						{/if}
					</span>
					{#if site.indexing && site.progress?.total}
						<span class="mt-1 block h-1 overflow-hidden rounded bg-zinc-800">
							<span
								class="block h-full bg-amber-400"
								style:width="{(site.progress.done / site.progress.total) * 100}%"
							></span>
						</span>
					{/if}
				</span>
				{#if renaming !== site.id}
					<button class={small} onclick={() => (renaming = site.id)}>Renombrar</button>
				{/if}
				<form method="post" action="?/refreshSite" use:enhance>
					<input type="hidden" name="id" value={site.id} />
					<button class={small} disabled={site.indexing}>Volver a leer</button>
				</form>
				<form method="post" action="?/removeSite" use:enhance>
					<input type="hidden" name="id" value={site.id} />
					<button class={small}>Quitar</button>
				</form>
			</li>
		{:else}
			<li class="py-2 text-sm text-zinc-500">Ninguna todavía.</li>
		{/each}
	</ul>
</section>
