<script lang="ts">
	import AddToQueue from '#lib/components/AddToQueue.svelte';
	import { enhance } from '$app/forms';
	import AlbumCover from 'comun/components/AlbumCover.svelte';
	import MusicTargetSwitch from '#lib/components/MusicTargetSwitch.svelte';
	import TitleForm from '#lib/components/TitleForm.svelte';
	import { formatDuration } from 'comun/format.ts';
	import { music } from 'comun/music-player.svelte.ts';
	import { musicTarget } from 'comun/music-target.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let renaming = $state(false);
	let confirmDelete = $state(false);

	const playlist = $derived(data.playlist);
	const tracks = $derived(playlist.items.map((i) => i.track));
	const totalSec = $derived(tracks.reduce((sum, t) => sum + (t.durationSec ?? 0), 0));
	/** Only where Snapcast is set up; elsewhere, always this device. */
	const toSnapcast = $derived(data.snapcast && musicTarget.value === 'snapcast');
</script>

<svelte:head>
	<title>{playlist.name} · JellyCartoon</title>
</svelte:head>

<a href="/musica/listas" class="text-sm text-zinc-400 hover:text-white">← Listas</a>
<div class="mt-2 mb-1 flex flex-wrap items-center gap-3">
	{#if renaming}
		<TitleForm action="?/rename" value={playlist.name} onclose={() => (renaming = false)} />
	{:else}
		<h1 class="flex items-center gap-2 text-2xl font-bold">
			{playlist.name}
			<button
				class="rounded-md px-2 py-1 text-base text-zinc-500 hover:bg-zinc-800 hover:text-white"
				title="Cambiar nombre"
				aria-label="Cambiar nombre"
				onclick={() => (renaming = true)}>✎</button
			>
		</h1>
	{/if}
</div>
{#if form?.message}
	<p class="text-sm text-red-400">{form.message}</p>
{/if}

{#if !tracks.length}
	<p class="mt-4 text-zinc-400">
		Esta lista está vacía. Añade canciones con el «+» de cada una, en los <a
			href="/musica"
			class="text-amber-400 hover:underline">álbumes</a
		> o en el buscador.
	</p>
{:else}
	<p class="mb-4 text-sm text-zinc-400">{tracks.length} canciones · {formatDuration(totalSec)}</p>
	<div class="mb-4 flex flex-wrap items-center gap-2">
		<button
			class="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-amber-400"
			onclick={() => musicTarget.play(tracks, 0, toSnapcast)}>▶︎ Reproducir</button
		>
		<AddToQueue {tracks} {toSnapcast} />
	</div>
	{#if data.snapcast}
		<div class="mb-4"><MusicTargetSwitch /></div>
	{/if}

	<ol class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
		{#each playlist.items as item, i (item.itemId)}
			{@const t = item.track}
			<li class="flex items-center">
				<button
					class={[
						'flex min-w-0 flex-1 items-center gap-3 p-2 text-left hover:bg-zinc-900',
						music.current?.id === t.id && 'text-amber-400'
					]}
					onclick={() => musicTarget.play(tracks, i, toSnapcast)}
				>
					<AlbumCover
						album={{ id: t.albumId, hasCover: t.hasCover }}
						class="w-10 shrink-0 rounded"
					/>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm">{t.title}</span>
						<span class="block truncate text-xs text-zinc-400">{t.artist} · {t.album}</span>
					</span>
					<span class="text-xs text-zinc-500">{formatDuration(t.durationSec)}</span>
				</button>
				<form method="post" use:enhance class="flex shrink-0 flex-col text-xs text-zinc-500">
					<input type="hidden" name="itemId" value={item.itemId} />
					<button
						formaction="?/up"
						disabled={i === 0}
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
						disabled={i === playlist.items.length - 1}
						class="px-2 hover:text-white disabled:invisible"
						title="Bajar"
						aria-label="Bajar">▼</button
					>
				</form>
			</li>
		{/each}
	</ol>
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
