<script lang="ts">
	import { enhance } from '$app/forms';
	import PlaylistView from '#lib/components/PlaylistView.svelte';
	import TitleForm from '#lib/components/TitleForm.svelte';
	import { formatDuration } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let renaming = $state(false);
	let confirmDelete = $state(false);

	let items = $derived(data.list.items);
	let totalSec = $derived(items.reduce((sum, i) => sum + (i.durationSec ?? 0), 0));
	let remainingSec = $derived(
		items.filter((i) => !i.watched).reduce((sum, i) => sum + (i.durationSec ?? 0), 0)
	);
</script>

{#snippet listButton(action: string, label: string)}
	<form method="post" action="?/{action}" use:enhance>
		<button class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-900">
			{label}
		</button>
	</form>
{/snippet}

<a href="/lists" class="text-sm text-zinc-400 hover:text-white">← Listas</a>
<div class="mb-1 flex flex-wrap items-center gap-3">
	{#if renaming}
		<TitleForm action="?/rename" value={data.list.name} onclose={() => (renaming = false)} />
	{:else}
		<h1 class="flex items-center gap-2 text-2xl font-bold">
			{data.list.name}
			<button
				class="rounded-md px-2 py-1 text-base text-zinc-500 hover:bg-zinc-800 hover:text-white"
				title="Cambiar nombre"
				aria-label="Cambiar nombre"
				onclick={() => (renaming = true)}>✎</button
			>
		</h1>
		{#if data.active}
			<span class="text-sm text-amber-400">Activa</span>
		{:else}
			{@render listButton('activate', 'Activar')}
		{/if}
	{/if}
</div>
{#if form?.message}
	<p class="text-sm text-red-400">{form.message}</p>
{/if}

{#if items.length === 0}
	<p class="mt-4 text-zinc-400">
		Esta lista está vacía.
		{#if data.active}
			Entra en una serie y pulsa «+ Lista» en los capítulos que quieras.
		{:else}
			Actívala y luego, en la página de una serie, pulsa «+ Lista» en los capítulos que quieras.
		{/if}
	</p>
{:else}
	<p class="mb-6 text-sm text-zinc-400">
		{items.length} capítulos · {formatDuration(totalSec)}
		{#if remainingSec && remainingSec < totalSec}· quedan {formatDuration(remainingSec)}{/if}
	</p>

	<PlaylistView {items} settings={data.settings}>
		{#snippet finished()}
			<p class="text-lg">¡Lista terminada!</p>
			{@render listButton('restart', 'Volver a empezar')}
		{/snippet}
		{#snippet itemActions(item, index)}
			<form method="post" use:enhance class="flex shrink-0 flex-col text-xs text-zinc-500">
				<input type="hidden" name="episodeId" value={item.id} />
				<button
					formaction="?/up"
					disabled={index === 0}
					class="px-2 hover:text-white disabled:invisible"
					title="Subir"
					aria-label="Subir">▲</button
				>
				<button
					formaction="?/remove"
					class="px-2 hover:text-red-400"
					title="Quitar de la lista"
					aria-label="Quitar de la lista">✕</button
				>
				<button
					formaction="?/down"
					disabled={index === items.length - 1}
					class="px-2 hover:text-white disabled:invisible"
					title="Bajar"
					aria-label="Bajar">▼</button
				>
			</form>
		{/snippet}
		{#snippet footer()}
			{#if remainingSec < totalSec}
				<div class="mt-4">{@render listButton('restart', 'Volver a empezar')}</div>
			{/if}
		{/snippet}
	</PlaylistView>
{/if}

<section class="mt-10 border-t border-zinc-800 pt-6">
	{#if confirmDelete}
		<form method="post" action="?/delete" use:enhance class="flex items-center gap-2">
			<button class="rounded-md bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-500">
				Sí, borrar la lista
			</button>
			<button
				type="button"
				class="rounded-md px-3 py-2 text-zinc-400 hover:text-white"
				onclick={() => (confirmDelete = false)}>Cancelar</button
			>
		</form>
	{:else}
		<button
			class="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-900"
			onclick={() => (confirmDelete = true)}
		>
			Borrar lista
		</button>
	{/if}
</section>
