<script lang="ts">
	import AddToQueue from 'comun/components/AddToQueue.svelte';
	import AddToPlaylist from 'comun/components/AddToPlaylist.svelte';
	import AlbumCover from 'comun/components/AlbumCover.svelte';
	import { formatDuration } from 'comun/format.ts';
	import { artistUrl } from 'comun/music.ts';
	import { music } from 'comun/music-player.svelte.ts';
	import { musicTarget } from 'comun/music-target.svelte.ts';
	import type { PageProps } from './$types';

	/**
	 * An album (#253), as jellycartoon's: to play it, queue it, or a track into a playlist. Without
	 * changing its titles or its cover: that is at home.
	 */
	let { data }: PageProps = $props();

	const album = $derived(data.album);
	const totalSec = $derived(album.tracks.reduce((sum, t) => sum + (t.durationSec ?? 0), 0));
</script>

<svelte:head>
	<title>{album.title} · Seilide</title>
</svelte:head>

<nav class="flex min-w-0 items-center gap-1.5 text-sm text-zinc-400">
	<a href="/musica" class="shrink-0 hover:text-white">Música</a>
	<span aria-hidden="true">›</span>
	<a href={artistUrl(album.artist)} class="truncate hover:text-white">{album.artist}</a>
</nav>

<div class="mt-3 mb-6 flex flex-col gap-4 sm:flex-row sm:items-end">
	<AlbumCover {album} class="w-48 shrink-0 rounded-md" />
	<div class="min-w-0">
		<h1 class="text-2xl font-bold">{album.title}</h1>
		<p>
			<a href={artistUrl(album.artist)} class="text-zinc-300 hover:text-white hover:underline"
				>{album.artist}</a
			>
		</p>
		<p class="mb-3 text-sm text-zinc-400">
			{album.tracks.length} canciones · {formatDuration(totalSec)}
		</p>
		<div class="flex flex-wrap gap-2">
			<button
				class="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-amber-400"
				onclick={() => musicTarget.play(album.tracks, 0, false)}>▶︎ Reproducir</button
			>
			<AddToQueue tracks={album.tracks} toSnapcast={false} />
		</div>
	</div>
</div>

<ol class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
	{#each album.tracks as t, i (t.id)}
		<li class="flex items-center pr-1">
			<button
				class={[
					'flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left hover:bg-zinc-900',
					music.current?.id === t.id && 'text-amber-400'
				]}
				onclick={() => musicTarget.play(album.tracks, i, false)}
			>
				<span class="w-6 shrink-0 text-right font-mono text-xs text-zinc-500 tabular-nums">
					{music.current?.id === t.id && music.playing ? '♪' : (t.number ?? i + 1)}
				</span>
				<span class="min-w-0 flex-1">
					<span class="block truncate text-sm">{t.title}</span>
					{#if t.artist !== album.artist}
						<span class="block truncate text-xs text-zinc-400">{t.artist}</span>
					{/if}
				</span>
				<span class="text-xs text-zinc-500">{formatDuration(t.durationSec)}</span>
			</button>
			<AddToPlaylist trackId={t.id} key="album-{t.id}" playlists={data.playlists} />
		</li>
	{/each}
</ol>
