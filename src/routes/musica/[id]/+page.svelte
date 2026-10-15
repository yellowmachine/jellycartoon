<script lang="ts">
	import AddToPlaylist from '#lib/components/AddToPlaylist.svelte';
	import AlbumCover from '#lib/components/AlbumCover.svelte';
	import MusicTargetSwitch from '#lib/components/MusicTargetSwitch.svelte';
	import TitleForm from '#lib/components/TitleForm.svelte';
	import { formatDuration } from '#lib/format.ts';
	import { artistUrl } from '#lib/music.ts';
	import { music } from '#lib/music-player.svelte.ts';
	import { musicTarget } from '#lib/music-target.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const album = $derived(data.album);
	/** Only where Snapcast is set up; elsewhere, always this device. */
	const toSnapcast = $derived(data.snapcast && musicTarget.value === 'snapcast');
	/** What is being renamed: the album, its artist, a track id, or nothing. */
	let editing = $state<'album' | 'artist' | number | null>(null);
	const totalSec = $derived(album.tracks.reduce((sum, t) => sum + (t.durationSec ?? 0), 0));
</script>

<svelte:head>
	<title>{album.title} · JellyCartoon</title>
</svelte:head>

{#snippet editButton(target: 'album' | 'artist' | number, label: string)}
	<button
		class="shrink-0 rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-white"
		title={label}
		aria-label={label}
		onclick={() => (editing = target)}>✎</button
	>
{/snippet}

<nav class="flex min-w-0 items-center gap-1.5 text-sm text-zinc-400">
	<a href="/musica" class="shrink-0 hover:text-white">Música</a>
	<span aria-hidden="true">›</span>
	<a href={artistUrl(album.artist)} class="truncate hover:text-white">{album.artist}</a>
</nav>

<div class="mt-3 mb-6 flex flex-col gap-4 sm:flex-row sm:items-end">
	<AlbumCover {album} class="w-48 shrink-0 rounded-md" />
	<div class="min-w-0">
		{#if editing === 'album'}
			<div class="flex">
				<TitleForm
					action="?/renameAlbum"
					value={album.title}
					placeholder={data.tagTitles.album}
					onclose={() => (editing = null)}
				/>
			</div>
		{:else}
			<h1 class="flex items-center gap-2 text-2xl font-bold">
				{album.title}
				{@render editButton('album', 'Cambiar título del álbum')}
			</h1>
		{/if}
		{#if editing === 'artist'}
			<div class="flex">
				<TitleForm
					action="?/renameArtist"
					value={album.artist}
					placeholder={data.tagTitles.artist}
					label="Artista"
					onclose={() => (editing = null)}
				/>
			</div>
		{:else}
			<p class="flex items-center gap-1">
				<a href={artistUrl(album.artist)} class="text-zinc-300 hover:text-white hover:underline"
					>{album.artist}</a
				>
				{@render editButton('artist', 'Cambiar el artista del álbum')}
			</p>
		{/if}
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
			{#if editing === t.id}
				<div class="flex min-w-0 flex-1 items-center gap-3 px-3 py-2">
					<span class="w-6 shrink-0 text-right font-mono text-xs text-zinc-500 tabular-nums"
						>{t.number ?? i + 1}</span
					>
					<TitleForm
						action="?/renameTrack"
						value={t.title}
						placeholder={data.tagTitles.tracks[t.id]}
						hidden={{ id: t.id }}
						onclose={() => (editing = null)}
					/>
				</div>
			{:else}
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
				{@render editButton(t.id, 'Cambiar título de la canción')}
			{/if}
			<AddToPlaylist trackId={t.id} key="album-{t.id}" playlists={data.playlists} />
		</li>
	{/each}
</ol>
