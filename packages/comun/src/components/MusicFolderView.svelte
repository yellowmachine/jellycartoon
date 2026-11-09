<script lang="ts">
	import type { Snippet } from 'svelte';
	import { formatDuration } from '../format.ts';
	import { folderUrl, mixed, type MusicFolder } from '../music.ts';
	import { musicTarget } from '../music-target.svelte.ts';
	import AddToPlaylist from './AddToPlaylist.svelte';
	import AddToQueue from './AddToQueue.svelte';
	import TrackRows from './TrackRows.svelte';

	/**
	 * Música → Carpetas, in jellycartoon and in Seilide: the music as it is on disk, folder by
	 * folder, with what has no album too (a podcast downloaded, a talk). Its own audios play in
	 * order from the one touched; the folders inside, opened.
	 */
	interface Props {
		folder: MusicFolder;
		playlists: { id: number; name: string }[];
		/** Played on the house's speakers (jellycartoon, when chosen); else on this device. */
		toSnapcast: boolean;
		/** Beside the buttons: where it plays (jellycartoon's switch). */
		extra?: Snippet;
	}

	let { folder, playlists, toSnapcast, extra }: Props = $props();

	/** «Música › Podcasts › Charlas», each a link but the last. */
	const crumbs = $derived(
		folder.path
			? folder.path
					.split('/')
					.map((name, i, all) => ({ name, path: all.slice(0, i + 1).join('/') }))
			: []
	);
	const totalSec = $derived(folder.tracks.reduce((sum, t) => sum + (t.durationSec ?? 0), 0));
	const audios = (n: number) => `${n} ${n === 1 ? 'audio' : 'audios'}`;
</script>

<nav class="flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-zinc-400">
	{#if crumbs.length}
		<a href={folderUrl('')} class="shrink-0 hover:text-white">Carpetas</a>
		{#each crumbs.slice(0, -1) as c (c.path)}
			<span aria-hidden="true">›</span>
			<a href={folderUrl(c.path)} class="truncate hover:text-white">{c.name}</a>
		{/each}
	{/if}
</nav>
<h1 class="mt-1 mb-4 text-2xl font-bold break-words">{crumbs.length ? folder.name : 'Carpetas'}</h1>

{#if folder.folders.length}
	<ul class="mb-6 divide-y divide-zinc-800 rounded-md border border-zinc-800">
		{#each folder.folders as f (f.path)}
			<li>
				<a href={folderUrl(f.path)} class="flex items-center gap-3 p-3 hover:bg-zinc-900">
					<span aria-hidden="true" class="text-xl">📁</span>
					<span class="min-w-0 flex-1 truncate">{f.name}</span>
					<span class="shrink-0 text-xs text-zinc-500"
						>{audios(f.tracks)} · {formatDuration(f.durationSec)}</span
					>
				</a>
			</li>
		{/each}
	</ul>
{/if}

{#if folder.tracks.length}
	<p class="mb-3 text-sm text-zinc-400">
		{audios(folder.tracks.length)} · {formatDuration(totalSec)}
	</p>
	<div class="mb-4 flex flex-wrap items-center gap-2">
		<button
			class="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-amber-400"
			onclick={() => musicTarget.play(folder.tracks, 0, toSnapcast)}>▶︎ Reproducir</button
		>
		<button
			class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
			onclick={() => musicTarget.play(mixed(folder.tracks), 0, toSnapcast)}
			>🔀 Mezclar y reproducir</button
		>
		<AddToQueue tracks={folder.tracks} {toSnapcast} />
		<AddToPlaylist
			trackIds={folder.tracks.map((t) => t.id)}
			key="carpeta"
			{playlists}
			text="+ Añadir a una lista"
		/>
		{@render extra?.()}
	</div>
	<TrackRows
		tracks={folder.tracks}
		key="carpeta"
		{playlists}
		onplay={(_, i) => musicTarget.play(folder.tracks, i, toSnapcast)}
	/>
{/if}
