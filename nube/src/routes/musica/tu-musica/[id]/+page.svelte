<script lang="ts">
	import { enhance } from '$app/forms';
	import AddToPlaylist from 'comun/components/AddToPlaylist.svelte';
	import AddToQueue from 'comun/components/AddToQueue.svelte';
	import { vista } from '#lib/vista.svelte.ts';
	import AlbumCover from 'comun/components/AlbumCover.svelte';
	import { formatDuration } from 'comun/format.ts';
	import { mixed } from 'comun/music.ts';
	import { music } from 'comun/music-player.svelte.ts';
	import { musicTarget } from 'comun/music-target.svelte.ts';
	import {
		asAlbum,
		OWN_LISTS_API,
		ownArtistUrl,
		ownTrackSrc,
		playable,
		playableTracks
	} from '#lib/own-music.ts';
	import type { PageProps } from './$types';

	/**
	 * An album of «Tu música» (#534): to play it, shuffled or not, or queue it. What this browser
	 * cannot play (an ALAC .m4a, a .wma) is there, greyed, and left out.
	 */
	let { data, form }: PageProps = $props();

	/** «Editar»: its title and artist, as the family wants them (the bucket is never written). */
	let editing = $state(false);
	let saving = $state(false);

	const album = $derived(data.ownAlbum);
	const tracks = $derived(playableTracks(album));
	const totalSec = $derived(album.tracks.reduce((sum, t) => sum + (t.durationSec ?? 0), 0));
	/** What sounds is this album's track (its own address: house ids may be the same numbers). */
	const isCurrent = (id: number) => music.current?.src === ownTrackSrc(id);
	const play = (id: number) =>
		void musicTarget.play(
			tracks,
			Math.max(
				0,
				tracks.findIndex((t) => t.id === id)
			),
			false
		);
</script>

<svelte:head>
	<title>{album.title} · Seilide</title>
</svelte:head>

<nav class="flex min-w-0 items-center gap-1.5 text-sm text-zinc-400">
	<a href="/musica/tu-musica" class="shrink-0 hover:text-white">Tu música</a>
	<span aria-hidden="true">›</span>
	<a href={ownArtistUrl(album.artist)} class="truncate hover:text-white">{album.artist}</a>
</nav>

<div class="mt-3 mb-6 flex flex-col gap-4 sm:flex-row sm:items-end">
	<AlbumCover album={asAlbum(album)} class="w-48 shrink-0 rounded-md" />
	<div class="min-w-0">
		{#if editing}
			<form
				method="post"
				action="?/rename"
				class="mb-3 space-y-2"
				use:enhance={() => {
					saving = true;
					return async ({ update, result }) => {
						await update({ reset: false });
						saving = false;
						if (result.type === 'success') editing = false;
					};
				}}
			>
				<label class="block text-sm text-zinc-400">
					Disco
					<input
						name="title"
						value={album.title}
						maxlength="300"
						class="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-base text-white"
					/>
				</label>
				<label class="block text-sm text-zinc-400">
					Artista
					<input
						name="artist"
						value={album.artist}
						maxlength="300"
						class="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-base text-white"
					/>
				</label>
				{#if album.tags}
					<p class="text-xs text-zinc-500">
						Sus etiquetas dicen «{album.tags.title}» de {album.tags.artist}. Vacío, vuelve a eso.
					</p>
				{/if}
				<p class="text-xs text-zinc-500">
					Solo cambia en Seilide: los ficheros de vuestro almacenamiento no se tocan. Si la portada
					era de MusicBrainz, se busca otra vez con el nombre nuevo.
				</p>
				<div class="flex gap-2">
					<button
						class="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
						disabled={saving}>Guardar</button
					>
					<button
						type="button"
						class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
						onclick={() => (editing = false)}>Cancelar</button
					>
				</div>
				{#if form?.problem}<p class="text-sm text-red-400">{form.problem}</p>{/if}
			</form>
		{:else}
			<h1 class="text-2xl font-bold">
				{album.title}
				{#if data.canEdit && !vista.kiosk}<button
						class="ml-1 align-middle text-base font-normal text-zinc-400 hover:text-white"
						aria-label="Editar el disco y el artista"
						title="Editar el disco y el artista"
						onclick={() => (editing = true)}>✎</button
					>{/if}
			</h1>
			<p>
				<a href={ownArtistUrl(album.artist)} class="text-zinc-300 hover:text-white hover:underline"
					>{album.artist}</a
				><span class="text-zinc-400">{album.year ? ` · ${album.year}` : ''}</span>
			</p>
		{/if}
		<p class="mb-3 text-sm text-zinc-400">
			{album.tracks.length}
			{album.tracks.length === 1 ? 'canción' : 'canciones'} · {formatDuration(totalSec)}
		</p>
		{#if tracks.length}
			<div class="flex flex-wrap gap-2">
				<button
					class="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-amber-400"
					onclick={() => musicTarget.play(tracks, 0, false)}>▶︎ Reproducir</button
				>
				<button
					class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
					onclick={() => musicTarget.play(mixed(tracks), 0, false)}>🔀 Mezclar y reproducir</button
				>
				<AddToQueue {tracks} toSnapcast={false} />
				{#if !vista.kiosk}<AddToPlaylist
						trackIds={tracks.map((t) => t.id)}
						key="album"
						playlists={data.ownLists}
						endpoint={OWN_LISTS_API}
						text="+ Añadir a una lista"
					/>{/if}
			</div>
		{/if}
	</div>
</div>

<ol class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
	{#each album.tracks as t, i (t.id)}
		<li class="flex items-center pr-1">
			{#if playable(t.mime)}
				<button
					class={[
						'flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left hover:bg-zinc-900',
						isCurrent(t.id) && 'text-amber-400'
					]}
					onclick={() => play(t.id)}
				>
					<span class="w-6 shrink-0 text-right font-mono text-xs text-zinc-500 tabular-nums">
						{isCurrent(t.id) && music.playing ? '♪' : (t.number ?? i + 1)}
					</span>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm">{t.title}</span>
						{#if t.artist !== album.artist}
							<span class="block truncate text-xs text-zinc-400">{t.artist}</span>
						{/if}
					</span>
					<span class="text-xs text-zinc-500">{formatDuration(t.durationSec)}</span>
				</button>
				{#if !vista.kiosk}<AddToPlaylist
						trackId={t.id}
						key="album-{t.id}"
						playlists={data.ownLists}
						endpoint={OWN_LISTS_API}
					/>{/if}
			{:else}
				<div
					class="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-zinc-600"
					title="Este navegador no lo puede reproducir"
				>
					<span class="w-6 shrink-0 text-right font-mono text-xs tabular-nums"
						>{t.number ?? i + 1}</span
					>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm">{t.title}</span>
						<span class="block truncate text-xs">Este navegador no lo puede reproducir</span>
					</span>
				</div>
			{/if}
		</li>
	{/each}
</ol>
