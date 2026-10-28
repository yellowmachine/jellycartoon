<script lang="ts">
	import MiniSearch from 'minisearch';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { poll } from 'comun/poll.ts';
	import AlbumCover from 'comun/components/AlbumCover.svelte';
	import AlbumGrid from 'comun/components/AlbumGrid.svelte';
	import DjDialog from 'comun/components/DjDialog.svelte';
	import MusicTargetSwitch from '#lib/components/MusicTargetSwitch.svelte';
	import TrackRows from 'comun/components/TrackRows.svelte';
	import {
		artistUrl,
		fold,
		groupByArtist,
		type MusicAlbum,
		type MusicArtist,
		type MusicTrack
	} from 'comun/music.ts';
	import { musicTarget } from 'comun/music-target.svelte.ts';
	import { saveView } from '#lib/views.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let search = $state('');
	/** From the cookie; changed here at once when switched. */
	let view = $derived(data.view);
	const artists = $derived(groupByArtist(data.albums));
	let djDialog = $state<DjDialog>();
	let djMenu = $state<HTMLElement>();

	const progress = $derived(data.progress);
	const totals = $derived(data.totals);
	const busy = $derived(progress.phase !== 'idle' || totals.pending > 0 || totals.opusPending > 0);
	/** Tags read so far, of every file found. */
	const read = $derived(totals.ready + totals.ignored + totals.errors);

	// While something is going on, the page follows it (also on other devices).
	$effect(() => {
		if (!busy) return;
		return poll(invalidateAll, 3000);
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

	// Albums and tracks in one index (https://lucaong.github.io/minisearch/), built in the browser.
	const index = $derived.by(() => {
		const ms = new MiniSearch<Doc>({
			fields: ['title', 'artist', 'album'],
			processTerm: fold,
			searchOptions: { prefix: true, fuzzy: 0.2, boost: { title: 2 }, combineWith: 'AND' }
		});
		ms.addAll([
			...artists.map((a, i) => ({ id: `r${i}`, title: a.name, artist: a.name })),
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
		const found: MusicArtist[] = [];
		const albums: MusicAlbum[] = [];
		const tracks: MusicTrack[] = [];
		for (const hit of index.search(query)) {
			const id = Number(String(hit.id).slice(1));
			if (String(hit.id).startsWith('r')) {
				found.push(artists[id]);
			} else if (String(hit.id).startsWith('a')) {
				const a = albumsById.get(id);
				if (a) albums.push(a);
			} else if (tracks.length < 50) {
				const t = tracksById.get(id);
				if (t) tracks.push(t);
			}
		}
		return { artists: found, albums, tracks };
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

{#snippet artistGrid(artists: MusicArtist[])}
	<div class="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
		{#each artists as artist (artist.name)}
			{@const covered = artist.albums.filter((a) => a.hasCover)}
			<a href={artistUrl(artist.name)} class="group">
				<!-- With four covers or more, a mosaic of them; else the first one. -->
				{#if covered.length >= 4}
					<div class="grid grid-cols-2 overflow-hidden rounded-md group-hover:opacity-80">
						{#each covered.slice(0, 4) as a (a.id)}
							<AlbumCover album={a} class="w-full" />
						{/each}
					</div>
				{:else}
					<AlbumCover
						album={covered[0] ?? artist.albums[0]}
						class="w-full rounded-md group-hover:opacity-80"
					/>
				{/if}
				<p class="mt-1 truncate text-sm">{artist.name}</p>
				<p class="truncate text-xs text-zinc-400">
					{artist.albums.length === 1 ? '1 álbum' : `${artist.albums.length} álbumes`}
				</p>
			</a>
		{/each}
	</div>
{/snippet}

<div class="mb-6 flex flex-wrap items-center gap-3">
	<h1 class="mr-auto text-2xl font-bold">Música</h1>
	{#if data.dj}
		{@const djClass = 'rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900'}
		{@const djTitle = 'Canciones al azar con un locutor entre ellas, como en la radio'}
		{#if data.djPresets.length}
			<!-- Native popover, as ActionMenu: closes with Esc or a click outside. -->
			<button class={djClass} title={djTitle} popovertarget="dj-menu" style:anchor-name="--dj-menu"
				>Modo DJ ▾</button
			>
			<div
				bind:this={djMenu}
				id="dj-menu"
				popover="auto"
				style:position-anchor="--dj-menu"
				class="dj-menu inset-auto m-0 mt-1 w-max max-w-72 min-w-48 rounded-md border border-zinc-700 bg-zinc-900 p-1 text-sm text-zinc-100 shadow-lg"
			>
				<button
					class="w-full rounded px-3 py-1.5 text-left hover:bg-zinc-800"
					onclick={() => {
						djMenu?.hidePopover();
						djDialog?.open();
					}}>Nuevo…</button
				>
				<div class="my-1 border-t border-zinc-800"></div>
				{#each data.djPresets as preset (preset.id)}
					<div class="group flex items-center rounded hover:bg-zinc-800">
						<button
							class="min-w-0 flex-1 truncate px-3 py-1.5 text-left"
							title="Empezar"
							onclick={() => {
								djMenu?.hidePopover();
								djDialog?.startPreset(preset);
							}}>{preset.name}</button
						>
						<!-- On hover with a mouse; always there on a touch screen. -->
						<div
							class="flex shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100"
						>
							<button
								class="px-2 py-1.5 text-zinc-400 hover:text-white"
								title="Editar"
								aria-label="Editar {preset.name}"
								onclick={() => {
									djMenu?.hidePopover();
									djDialog?.open(preset);
								}}>✎</button
							>
							<form method="post" action="?/djDelete" use:enhance>
								<input type="hidden" name="id" value={preset.id} />
								<button
									class="px-2 py-1.5 text-zinc-400 hover:text-red-400"
									title="Borrar"
									aria-label="Borrar {preset.name}">✕</button
								>
							</form>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<button class={djClass} title={djTitle} onclick={() => djDialog?.open()}>Modo DJ</button>
		{/if}
		<DjDialog bind:this={djDialog} {artists} voices={data.djVoices} />
	{/if}
	<input
		type="search"
		bind:value={search}
		placeholder="Artista, álbum o canción"
		aria-label="Buscar por artista, álbum o canción"
		class="w-56 rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm"
	/>
	<form method="post" action="?/scan" use:enhance hidden={data.kid}>
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
			<span class="text-amber-400">buscando ficheros… {progress.found} de música</span>
		{:else if progress.phase === 'reading' || totals.pending}
			<span class="text-amber-400">leyendo etiquetas · quedan {totals.pending}</span>
		{:else if progress.phase === 'covers'}
			<span class="text-amber-400"
				>buscando portadas · {progress.coversDone} de {progress.coversTotal}</span
			>
		{:else if totals.opusPending}
			<span class="text-amber-400">comprimiendo para el móvil · quedan {totals.opusPending}</span>
		{:else}
			{totals.ready} canciones · {totals.albums} álbumes
			{#if totals.errors + totals.opusErrors}<span class="text-red-400">
					· {totals.errors + totals.opusErrors} errores</span
				>{/if}
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
		{:else if totals.opusPending}
			<div class="mb-3 h-1.5 rounded bg-zinc-800">
				<div
					class="h-full rounded bg-amber-400"
					style:width="{((totals.ready - totals.opusPending) / (totals.ready || 1)) * 100}%"
				></div>
			</div>
		{/if}
		<dl class="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
			{#each [['Canciones', totals.ready], ['Álbumes', totals.albums], ['Con portada', totals.found], ['Sin etiqueta de álbum', totals.ignored], ['Errores', totals.errors + totals.opusErrors]] as [label, value] (label)}
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
				<br />{totals.notFound} álbumes sin portada, ni en MusicBrainz ni dentro de sus ficheros.
			{/if}
			Las descargas (sin etiqueta de álbum, o con el id de YouTube en el nombre) no se catalogan.
			<br />Cada FLAC se comprime también en Opus, para escucharlo con datos móviles (Ajustes →
			Calidad de la música).
		</p>
		{#if totals.notFound}
			<form method="post" action="?/covers" use:enhance class="mt-2" hidden={data.kid}>
				<button
					disabled={progress.phase !== 'idle'}
					class="rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900 disabled:opacity-50"
				>
					Volver a buscar portadas
				</button>
			</form>
		{/if}
		{#if progress.lastError}
			<p class="mt-2 text-sm text-red-400">No se pudo escanear: {progress.lastError}</p>
		{/if}
		{#if totals.errors + totals.opusErrors}
			<div class="mt-3">
				<form method="post" action="?/retry" use:enhance class="mb-2" hidden={data.kid}>
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
			No hay música todavía. Pulsa «Escanear carpeta». Se catalogan los FLAC y Opus con etiqueta de
			álbum, como los ripeados de CD o lo bajado con yt-dlp guardando las etiquetas; las descargas
			con el id del vídeo en el nombre se dejan fuera.
		</p>
	{/if}
{:else if results}
	{#if results.artists.length}
		<h2 class="mb-3 text-lg font-semibold">Artistas</h2>
		<div class="mb-8">{@render artistGrid(results.artists)}</div>
	{/if}
	{#if results.albums.length}
		<h2 class="mb-3 text-lg font-semibold">Álbumes</h2>
		<div class="mb-8"><AlbumGrid albums={results.albums} /></div>
	{/if}
	{#if results.tracks.length}
		<h2 class="mb-3 text-lg font-semibold">Canciones</h2>
		<TrackRows
			tracks={results.tracks}
			key="search"
			playlists={data.playlists}
			onplay={(t) => playTrack(t)}
		/>
	{/if}
	{#if !results.artists.length && !results.albums.length && !results.tracks.length}
		<p class="text-zinc-400">Nada coincide con «{search}».</p>
	{/if}
{:else}
	<div class="mb-4 flex items-center justify-between gap-3">
		<p class="text-sm text-zinc-400">
			{view === 'artists' ? `${artists.length} artistas · ` : ''}{data.albums.length} álbumes
		</p>
		<div
			class="flex rounded-md border border-zinc-700 p-0.5 text-sm"
			role="group"
			aria-label="Vista"
		>
			{#each [{ value: 'albums', label: 'Álbumes' }, { value: 'artists', label: 'Artistas' }] as const as { value, label } (value)}
				<button
					class={[
						'rounded px-2 py-0.5',
						view === value ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-white'
					]}
					aria-pressed={view === value}
					onclick={() => {
						view = value;
						saveView('music', value);
					}}>{label}</button
				>
			{/each}
		</div>
	</div>
	{#if view === 'artists'}
		{@render artistGrid(artists)}
	{:else}
		<AlbumGrid albums={data.albums} />
	{/if}
{/if}

<style>
	/* Below the button, aligned to its right edge; above it if there is no room underneath. */
	.dj-menu {
		position-area: bottom span-left;
		position-try-fallbacks: flip-block;
	}
</style>
