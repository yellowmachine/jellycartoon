<script lang="ts">
	import AddToPlaylist from '#lib/components/AddToPlaylist.svelte';
	import AlbumCover from '#lib/components/AlbumCover.svelte';
	import MusicTargetSwitch from '#lib/components/MusicTargetSwitch.svelte';
	import { formatDuration } from '#lib/format.ts';
	import { music } from '#lib/music-player.svelte.ts';
	import { musicTarget } from '#lib/music-target.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const album = $derived(data.album);
	/** Only where Snapcast is set up; elsewhere, always this device. */
	const toSnapcast = $derived(data.snapcast && musicTarget.value === 'snapcast');
	const totalSec = $derived(album.tracks.reduce((sum, t) => sum + (t.durationSec ?? 0), 0));
</script>

<svelte:head>
	<title>{album.title} · JellyCartoon</title>
</svelte:head>

<a href="/musica" class="text-sm text-zinc-400 hover:text-white">← Música</a>

<div class="mt-3 mb-6 flex flex-col gap-4 sm:flex-row sm:items-end">
	<AlbumCover {album} class="w-48 shrink-0 rounded-md" />
	<div class="min-w-0">
		<h1 class="text-2xl font-bold">{album.title}</h1>
		<p class="text-zinc-300">{album.artist}</p>
		<p class="mb-3 text-sm text-zinc-400">
			{album.tracks.length} canciones · {formatDuration(totalSec)}
		</p>
		<div class="flex flex-wrap gap-2">
			<button
				class="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-amber-400"
				onclick={() => musicTarget.play(album.tracks, 0, toSnapcast)}>▶︎ Reproducir</button
			>
			<button
				class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-900"
				onclick={() => musicTarget.append(album.tracks, toSnapcast)}>+ Añadir a la cola</button
			>
		</div>
	</div>
</div>

{#if data.snapcast}
	<div class="mb-4"><MusicTargetSwitch /></div>
{/if}

<ol class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
	{#each album.tracks as t, i (t.id)}
		<li class="flex items-center pr-1">
			<button
				class={[
					'flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left hover:bg-zinc-900',
					music.current?.id === t.id && 'text-amber-400'
				]}
				onclick={() => musicTarget.play(album.tracks, i, toSnapcast)}
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
