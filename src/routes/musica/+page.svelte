<script lang="ts">
	import MiniSearch from 'minisearch';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import AddToPlaylist from '#lib/components/AddToPlaylist.svelte';
	import AlbumCover from '#lib/components/AlbumCover.svelte';
	import MusicTargetSwitch from '#lib/components/MusicTargetSwitch.svelte';
	import { formatDuration } from '#lib/format.ts';
	import type { MusicAlbum, MusicTrack } from '#lib/music.ts';
	import { music } from '#lib/music-player.svelte.ts';
	import { musicTarget } from '#lib/music-target.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let search = $state('');

	const progress = $derived(data.progress);
	const totals = $derived(data.totals);
	const busy = $derived(progress.phase !== 'idle' || totals.pending > 0);
	/** Tags read so far, of every file found. */
	const read = $derived(totals.ready + totals.ignored + totals.errors);

	// While something is going on, the page follows it (also on other devices).
	$effect(() => {
		if (!busy) return;
		const timer = setInterval(() => invalidateAll(), 3000);
		return () => clearInterval(timer);
	});

	const sinceScan = (at: number) => {
		const minutes = Math.round((Date.now() - at) / 60_000);
		return minutes < 1
			? 'hace un momento'
			: minutes < 60
				? `hace ${minutes} min`
				: `hace ${Math.round(minutes / 60)} h`;
	};

	interface Doc {
		id: string;
		title: string;
		artist: string;
		album?: string;
	}

	/** Accents and case do not matter: «heroes» finds «Héroes del Silencio». */
	const fold = (term: string) =>
		term
			.normalize('NFD')
			.replace(/\p{Diacritic}/gu, '')
			.toLowerCase();

	// Albums and tracks in one index (https://lucaong.github.io/minisearch/), built in the browser.
	const index = $derived.by(() => {
		const ms = new MiniSearch<Doc>({
			fields: ['title', 'artist', 'album'],
			processTerm: fold,
			searchOptions: { prefix: true, fuzzy: 0.2, boost: { title: 2 }, combineWith: 'AND' }
		});
		ms.addAll([
			...data.albums.map((a) => ({ id: `a${a.id}`, title: a.title, artist: a.artist })),
			...data.albums.flatMap((a) =>
				a.tracks.map((t) => ({ id: `t${t.id}`, title: t.title, artist: t.artist, album: a.title }))
			)
		]);
		return ms;
	});

	const albumsById = $derived(new Map(data.albums.map((a) => [a.id, a])));
	const tracksById = $derived(
		new Map(data.albums.flatMap((a) => a.tracks.map((t) => [t.id, t] as const)))
	);

	const results = $derived.by(() => {
		const query = search.trim();
		if (!query) return null;
		const albums: MusicAlbum[] = [];
		const tracks: MusicTrack[] = [];
		for (const hit of index.search(query)) {
			const id = Number(String(hit.id).slice(1));
			if (String(hit.id).startsWith('a')) {
				const a = albumsById.get(id);
				if (a) albums.push(a);
			} else if (tracks.length < 50) {
				const t = tracksById.get(id);
				if (t) tracks.push(t);
			}
		}
		return { albums, tracks };
	});

	/** The track and the rest of its album after it. */
	function playTrack(t: MusicTrack) {
		const a = albumsById.get(t.albumId);
		if (!a) return;
		void musicTarget.play(
			a.tracks,
			a.tracks.findIndex((x) => x.id === t.id),
			data.snapcast && musicTarget.value === 'snapcast'
		);
	}
</script>

<svelte:head>
	<title>Música · JellyCartoon</title>
</svelte:head>

{#snippet albumGrid(albums: MusicAlbum[])}
	<div class="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
		{#each albums as a (a.id)}
			<a href="/musica/{a.id}" class="group">
				<AlbumCover album={a} class="w-full rounded-md group-hover:opacity-80" />
				<p class="mt-1 truncate text-sm">{a.title}</p>
				<p class="truncate text-xs text-zinc-400">{a.artist}</p>
			</a>
		{/each}
	</div>
{/snippet}

<div class="mb-6 flex flex-wrap items-center gap-3">
	<h1 class="mr-auto text-2xl font-bold">Música</h1>
	<input
		type="search"
		bind:value={search}
		placeholder="Artista, álbum o canción"
		aria-label="Buscar por artista, álbum o canción"
		class="w-56 rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm"
	/>
	<form method="post" action="?/scan" use:enhance>
		<button
			disabled={progress.phase === 'scanning'}
			class="rounded-md bg-amber-500 px-3 py-1 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
		>
			{progress.phase === 'scanning' ? 'Escaneando…' : 'Escanear carpeta'}
		</button>
	</form>
</div>

{#if data.snapcast}
	<div class="-mt-2 mb-6"><MusicTargetSwitch /></div>
{/if}

<!-- Like Gestión: totals, what is going on now, and the errors. -->
<details class="mb-6 rounded-md border border-zinc-800" open={busy || undefined}>
	<summary class="cursor-pointer p-3 text-sm">
		<span class="text-zinc-400">Catálogo:</span>
		{#if progress.phase === 'scanning'}
			<span class="text-amber-400">buscando ficheros… {progress.found} FLAC</span>
		{:else if progress.phase === 'reading' || totals.pending}
			<span class="text-amber-400">leyendo etiquetas · quedan {totals.pending}</span>
		{:else if progress.phase === 'covers'}
			<span class="text-amber-400"
				>buscando portadas · {progress.coversDone} de {progress.coversTotal}</span
			>
		{:else}
			{totals.ready} canciones · {totals.albums} álbumes
			{#if totals.errors}<span class="text-red-400"> · {totals.errors} errores</span>{/if}
		{/if}
	</summary>
	<div class="border-t border-zinc-800 p-3">
		{#if progress.phase === 'reading' || totals.pending}
			<div class="mb-3 h-1.5 rounded bg-zinc-800">
				<div
					class="h-full rounded bg-amber-400"
					style:width="{(read / (read + totals.pending || 1)) * 100}%"
				></div>
			</div>
		{:else if progress.phase === 'covers'}
			<div class="mb-3 h-1.5 rounded bg-zinc-800">
				<div
					class="h-full rounded bg-amber-400"
					style:width="{(progress.coversDone / (progress.coversTotal || 1)) * 100}%"
				></div>
			</div>
		{/if}
		<dl class="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
			{#each [['Canciones', totals.ready], ['Álbumes', totals.albums], ['Con portada', totals.found], ['Sin etiqueta de álbum', totals.ignored], ['Errores', totals.errors]] as [label, value] (label)}
				<div class="rounded-md border border-zinc-800 p-2">
					<dt class="text-xs text-zinc-400">{label}</dt>
					<dd class="text-xl font-semibold">{value}</dd>
				</div>
			{/each}
		</dl>
		<p class="text-xs text-zinc-500">
			{#if progress.lastScan}
				Último escaneo {sinceScan(progress.lastScan.at)}: {progress.lastScan.added} nuevas · {progress
					.lastScan.changed} cambiadas · {progress.lastScan.missing} desaparecidas
				{#if progress.lastScan.waiting}
					· {progress.lastScan.waiting} aún se están copiando: vuelve a escanear en un minuto.
				{/if}
			{/if}
			{#if totals.notFound}
				<br />{totals.notFound} álbumes sin portada en MusicBrainz.
			{/if}
			Las descargas (sin etiqueta de álbum, o con el id de YouTube en el nombre) no se catalogan.
		</p>
		{#if progress.lastError}
			<p class="mt-2 text-sm text-red-400">No se pudo escanear: {progress.lastError}</p>
		{/if}
		{#if totals.errors}
			<div class="mt-3">
				<form method="post" action="?/retry" use:enhance class="mb-2">
					<button class="rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900">
						Reintentar errores
					</button>
				</form>
				<ul class="space-y-1 text-xs">
					{#each totals.errorsList as e (e.id)}
						<li>
							<span class="font-mono break-all">{e.path}</span>
							<span class="block text-red-400">{e.error}</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>
</details>

{#if data.albums.length === 0}
	{#if !busy}
		<p class="text-zinc-400">
			No hay música todavía. Pulsa «Escanear carpeta». Se catalogan los FLAC con etiqueta de álbum,
			como los ripeados de CD; las descargas de YouTube se dejan fuera.
		</p>
	{/if}
{:else if results}
	{#if results.albums.length}
		<h2 class="mb-3 text-lg font-semibold">Álbumes</h2>
		<div class="mb-8">{@render albumGrid(results.albums)}</div>
	{/if}
	{#if results.tracks.length}
		<h2 class="mb-3 text-lg font-semibold">Canciones</h2>
		<ol class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
			{#each results.tracks as t (t.id)}
				<li class="flex items-center pr-1">
					<button
						class={[
							'flex min-w-0 flex-1 items-center gap-3 p-2 text-left hover:bg-zinc-900',
							music.current?.id === t.id && 'text-amber-400'
						]}
						onclick={() => playTrack(t)}
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
					<AddToPlaylist trackId={t.id} key="search-{t.id}" playlists={data.playlists} />
				</li>
			{/each}
		</ol>
	{/if}
	{#if !results.albums.length && !results.tracks.length}
		<p class="text-zinc-400">Nada coincide con «{search}».</p>
	{/if}
{:else}
	<p class="mb-4 text-sm text-zinc-400">{data.albums.length} álbumes</p>
	{@render albumGrid(data.albums)}
{/if}
