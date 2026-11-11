<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { enhance } from '$app/forms';
	import { euros, lineKey } from 'comun/expenses.ts';
	import ExpenseTabs from '#lib/components/ExpenseTabs.svelte';
	import type { PageProps } from './$types';

	/**
	 * Dinero → Etiquetas (#459): the own tags, renamed or deleted, and every text of the receipts'
	 * lines, the most bought first, to tick many and give them a tag at once.
	 */
	let { data }: PageProps = $props();

	/** At most, the texts shown: the search narrows them. */
	const SHOWN = 200;

	let search = $state('');
	/** `sin`, those with no tag; `todos`; or a tag's id. */
	let show = $state('sin');
	const ticked = new SvelteSet<string>();
	let tag = $state('');
	let name = $state('');
	let problem = $state<string | null>(null);
	let renaming = $state<{ id: number; name: string } | null>(null);
	let deleting = $state<number | null>(null);

	const tagName = (id: number | undefined) =>
		id === undefined ? null : (data.own.tags.find((t) => t.id === id)?.name ?? null);

	const found = $derived.by(() => {
		const words = lineKey(search);
		return data.texts.filter((t) => {
			const own = data.own.rules[t.key];
			if (show === 'sin' ? own !== undefined : show !== 'todos' && own !== Number(show))
				return false;
			return !words || t.key.includes(words);
		});
	});
	/** Each tag's texts, and what their lines add up to. */
	const perTag = $derived.by(() => {
		const sums = new Map<number, { texts: number; total: number }>();
		for (const t of data.texts) {
			const id = data.own.rules[t.key];
			if (id === undefined) continue;
			const s = sums.get(id) ?? { texts: 0, total: 0 };
			s.texts++;
			s.total += t.total;
			sums.set(id, s);
		}
		return sums;
	});

	const dayText = (day: string) =>
		new Date(`${day}T12:00:00Z`).toLocaleDateString('es-ES', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			timeZone: 'UTC'
		});

	const field =
		'rounded-md border-zinc-700 bg-zinc-950 py-1.5 text-sm focus:border-amber-500 focus:ring-amber-500';
	const button = 'rounded-md px-3 py-1.5 text-sm disabled:opacity-40';
	const chip = 'rounded bg-amber-900/60 px-1.5 text-xs text-amber-200';
	/** A tag's buttons, an icon each: with text they left its name no room on a phone. */
	const icon = 'shrink-0 rounded-md bg-zinc-800 px-2.5 py-1.5 leading-none hover:bg-zinc-700';

	/** After each form: what failed, said; else the page's data again. */
	const done =
		(after?: () => void) =>
		() =>
		async ({
			result,
			update
		}: {
			result: { type: string; data?: Record<string, unknown> };
			update: (o?: { reset?: boolean }) => Promise<void>;
		}) => {
			if (result.type === 'failure') problem = String(result.data?.message ?? 'No se pudo guardar');
			else if (result.type === 'success') {
				problem = null;
				after?.();
			}
			await update({ reset: false });
		};
</script>

<svelte:head>
	<title>Etiquetas · Dinero · Seilide</title>
</svelte:head>

<div class="mx-auto max-w-3xl pb-28">
	<h1 class="mb-3 text-2xl font-bold">Dinero</h1>
	<ExpenseTabs current="etiquetas" />

	{#if problem}
		<p class="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-200">{problem}</p>
	{/if}

	<h2 class="mb-2 text-lg font-semibold">Tus etiquetas</h2>
	{#if data.own.tags.length}
		<ul class="mb-8 divide-y divide-zinc-800">
			{#each data.own.tags as t (t.id)}
				{@const sum = perTag.get(t.id)}
				<li class="flex flex-wrap items-center gap-2 py-2">
					{#if renaming?.id === t.id}
						{@const r = renaming!}
						<form
							method="post"
							action="?/rename"
							class="flex flex-1 flex-wrap items-center gap-2"
							use:enhance={done(() => (renaming = null))}
						>
							<input type="hidden" name="id" value={t.id} />
							<!-- svelte-ignore a11y_autofocus -->
							<input
								name="name"
								bind:value={r.name}
								maxlength="40"
								aria-label="Nombre nuevo"
								autofocus
								class="{field} basis-full"
							/>
							<button class="{button} bg-amber-600 font-semibold text-white hover:bg-amber-500"
								>Guardar</button
							>
							<button
								type="button"
								class="{button} bg-zinc-800 hover:bg-zinc-700"
								onclick={() => (renaming = null)}>Cancelar</button
							>
							<p class="w-full text-xs text-zinc-500">
								Con el nombre de otra etiqueta, las dos quedan en una.
							</p>
						</form>
					{:else}
						<span class="min-w-0 flex-1">
							<span class={chip}>{t.name}</span>
							<span class="block text-sm text-zinc-400"
								>{sum?.texts ?? 0}
								{sum?.texts === 1 ? 'texto' : 'textos'} · {euros(sum?.total ?? 0)} en total</span
							>
						</span>
						<a
							href="/gastos/busqueda?etiqueta={t.id}"
							class={icon}
							title="Buscar sus gastos"
							aria-label="Buscar los gastos de {t.name}">🔍</a
						>
						<button
							class={icon}
							title="Cambiar nombre"
							aria-label="Cambiar el nombre de {t.name}"
							onclick={() => {
								renaming = { id: t.id, name: t.name };
								deleting = null;
							}}>✏️</button
						>
						{#if deleting === t.id}
							<form method="post" action="?/delete" use:enhance={done(() => (deleting = null))}>
								<input type="hidden" name="id" value={t.id} />
								<button class="{button} bg-red-700 font-semibold text-white hover:bg-red-600"
									>Sí, borrar</button
								>
							</form>
							<button
								class="{button} bg-zinc-800 hover:bg-zinc-700"
								onclick={() => (deleting = null)}>No</button
							>
						{:else}
							<button
								class={icon}
								title="Borrar: sus líneas se quedan sin etiqueta propia"
								aria-label="Borrar {t.name}"
								onclick={() => (deleting = t.id)}>🗑️</button
							>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mb-8 text-sm text-zinc-400">
			Aún ninguna. Marca abajo los textos de los tickets y ponles una nueva («Pan», «Agua»…), o toca
			una línea al abrir un gasto.
		</p>
	{/if}

	<h2 class="mb-1 text-lg font-semibold">Textos de los tickets</h2>
	<p class="mb-3 text-sm text-zinc-400">
		Cada texto, con las veces que se ha comprado. La etiqueta vale para todas sus líneas, las de
		antes y las que vengan.
	</p>
	<div class="mb-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
		<input
			type="search"
			bind:value={search}
			placeholder="Buscar: «barra», «agua»…"
			aria-label="Buscar un texto"
			class={field}
		/>
		<select bind:value={show} aria-label="Cuáles" class={field}>
			<option value="sin">Sin etiqueta</option>
			<option value="todos">Todos</option>
			{#each data.own.tags as t (t.id)}
				<option value={String(t.id)}>{t.name}</option>
			{/each}
		</select>
	</div>

	{#if found.length}
		<div class="mb-1 flex items-center justify-between text-xs text-zinc-500">
			<span
				>{found.length}
				{found.length === 1 ? 'texto' : 'textos'}{found.length > SHOWN
					? `, los ${SHOWN} más comprados: busca para ver los demás`
					: ''}</span
			>
			<button
				class="text-amber-400 hover:text-amber-300"
				onclick={() => found.slice(0, SHOWN).forEach((t) => ticked.add(t.key))}
				>Marcar los que se ven</button
			>
		</div>
		<ul class="divide-y divide-zinc-800">
			{#each found.slice(0, SHOWN) as t (t.key)}
				{@const own = tagName(data.own.rules[t.key])}
				<li>
					<label class="flex cursor-pointer items-center gap-3 py-2 hover:bg-zinc-900">
						<input
							type="checkbox"
							checked={ticked.has(t.key)}
							onchange={(e) => (e.currentTarget.checked ? ticked.add(t.key) : ticked.delete(t.key))}
							class="rounded border-zinc-600 bg-zinc-950 text-amber-600 focus:ring-amber-500"
						/>
						<span class="min-w-0 flex-1">
							<span class="block truncate"
								>{t.text}
								{#if own}<span class={chip}>{own}</span>{/if}</span
							>
							<span class="block text-xs text-zinc-500"
								>{t.count} {t.count === 1 ? 'vez' : 'veces'} · la última el {dayText(t.last)}</span
							>
						</span>
						<span class="shrink-0 text-sm tabular-nums">{euros(t.total)}</span>
					</label>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-sm text-zinc-400">
			{data.texts.length ? 'Ningún texto con eso.' : 'Aún no hay tickets con líneas.'}
		</p>
	{/if}
</div>

{#if ticked.size}
	<form
		method="post"
		action="?/tag"
		class="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-800 bg-zinc-900/95 px-4 py-3 backdrop-blur"
		use:enhance={done(() => {
			ticked.clear();
			name = '';
		})}
	>
		{#each [...ticked] as key (key)}
			<input type="hidden" name="text" value={key} />
		{/each}
		<div class="mx-auto flex max-w-3xl flex-wrap items-end gap-2">
			<span class="self-center text-sm"
				>{ticked.size} {ticked.size === 1 ? 'marcado' : 'marcados'}</span
			>
			<select name="tag" bind:value={tag} aria-label="Etiqueta" class={field}>
				<option value="">Sin etiqueta</option>
				{#each data.own.tags as t (t.id)}
					<option value={String(t.id)}>{t.name}</option>
				{/each}
				<option value="nueva">Nueva…</option>
			</select>
			{#if tag === 'nueva'}
				<input
					name="name"
					bind:value={name}
					maxlength="40"
					placeholder="Pan, Agua…"
					aria-label="Nombre de la etiqueta nueva"
					class="{field} basis-full"
				/>
			{/if}
			<button class="{button} bg-amber-600 font-semibold text-white hover:bg-amber-500"
				>Guardar</button
			>
			<button
				type="button"
				class="{button} bg-zinc-800 hover:bg-zinc-700"
				onclick={() => ticked.clear()}>Desmarcar</button
			>
		</div>
	</form>
{/if}
