<script lang="ts">
	import { mixed } from 'comun/music.ts';
	import { vista } from '#lib/vista.svelte.ts';
	import AddToQueue from 'comun/components/AddToQueue.svelte';
	import { enhance } from '$app/forms';
	import AlbumCover from 'comun/components/AlbumCover.svelte';
	import TitleForm from 'comun/components/TitleForm.svelte';
	import { formatDuration } from 'comun/format.ts';
	import { music } from 'comun/music-player.svelte.ts';
	import { asTrack, playable } from '#lib/own-music.ts';
	import { musicTarget } from 'comun/music-target.svelte.ts';
	import type { PageProps } from './$types';

	/**
	 * A list of «Tu música» (#534, phase 2), as the house's (listas/[id]): to play, reorder, rename
	 * or delete. What this browser cannot play (an ALAC .m4a) is there, greyed, and left out.
	 */
	let { data, form }: PageProps = $props();

	let renaming = $state(false);
	let confirmDelete = $state(false);

	const playlist = $derived(data.list);
	/** Each item as the player takes it, or null if this browser cannot play it. */
	const items = $derived(
		playlist.items.map((i) => ({
			itemId: i.itemId,
			track: asTrack(i.track, i.album),
			playable: playable(i.track.mime)
		}))
	);
	const tracks = $derived(items.filter((i) => i.playable).map((i) => i.track));
	const indexOf = (itemId: number) =>
		items.filter((i) => i.playable).findIndex((i) => i.itemId === itemId);
	const totalSec = $derived(tracks.reduce((sum, t) => sum + (t.durationSec ?? 0), 0));
</script>

<svelte:head>
	<title>{playlist.name} · Seilide</title>
</svelte:head>

<a href="/musica/listas" class="text-sm text-zinc-400 hover:text-white">← Listas</a>
<div class="mt-2 mb-1 flex flex-wrap items-center gap-3">
	{#if renaming}
		<TitleForm action="?/rename" value={playlist.name} onclose={() => (renaming = false)} />
	{:else}
		<h1 class="flex items-center gap-2 text-2xl font-bold">
			{playlist.name}
			{#if !vista.kiosk}<button
					class="rounded-md px-2 py-1 text-base text-zinc-500 hover:bg-zinc-800 hover:text-white"
					title="Cambiar nombre"
					aria-label="Cambiar nombre"
					onclick={() => (renaming = true)}>✎</button
				>{/if}
		</h1>
	{/if}
</div>
{#if form?.message}
	<p class="text-sm text-red-400">{form.message}</p>
{/if}

{#if !items.length}
	<p class="mt-4 text-zinc-400">
		Esta lista está vacía. Añade canciones con el «+» de cada una, en <a
			href="/musica/tu-musica"
			class="text-amber-400 hover:underline">Tu música</a
		>.
	</p>
{:else}
	<p class="mb-4 text-sm text-zinc-400">
		De Tu música · {items.length}
		{items.length === 1 ? 'canción' : 'canciones'} · {formatDuration(totalSec)}
	</p>
	<div class="mb-4 flex flex-wrap items-center gap-2">
		<button
			class="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-amber-400"
			onclick={() => musicTarget.play(tracks, 0, false)}>▶︎ Reproducir</button
		>
		<!-- Shuffled once, then played in that order (comun/music.ts, `mixed`): here or on Snapcast. -->
		<button
			class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
			onclick={() => musicTarget.play(mixed(tracks), 0, false)}>🔀 Mezclar y reproducir</button
		>
		<AddToQueue {tracks} toSnapcast={false} />
	</div>

	<ol class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
		{#each items as item, i (item.itemId)}
			{@const t = item.track}
			<li class="flex items-center">
				<button
					class={[
						'flex min-w-0 flex-1 items-center gap-3 p-2 text-left hover:bg-zinc-900 disabled:text-zinc-600',
						music.current?.src === t.src && 'text-amber-400'
					]}
					disabled={!item.playable}
					title={item.playable ? undefined : 'Este navegador no lo puede reproducir'}
					onclick={() => musicTarget.play(tracks, indexOf(item.itemId), false)}
				>
					<AlbumCover
						album={{ id: t.albumId, hasCover: t.hasCover, cover: t.cover }}
						class="w-10 shrink-0 rounded"
					/>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm">{t.title}</span>
						<span class="block truncate text-xs text-zinc-400">{t.artist} · {t.album}</span>
					</span>
					<span class="text-xs text-zinc-500">{formatDuration(t.durationSec)}</span>
				</button>
				<!-- Locked Vista (#532): listened to as it is. -->
				{#if !vista.kiosk}
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
							disabled={i === items.length - 1}
							class="px-2 hover:text-white disabled:invisible"
							title="Bajar"
							aria-label="Bajar">▼</button
						>
					</form>
				{/if}
			</li>
		{/each}
	</ol>
{/if}

{#if !vista.kiosk}
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
{/if}
