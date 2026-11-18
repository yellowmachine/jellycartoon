<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { fold, mixed } from 'comun/music.ts';
	import { musicTarget } from 'comun/music-target.svelte.ts';
	import { ownAlbumUrl, ownCoverUrl, playableTracks, type OwnAlbumRow } from '#lib/own-music.ts';
	import type { PageProps } from './$types';

	/**
	 * «Tu música» (#534): the music the family keeps in its own bucket, apart from the house's. By
	 * album or by artist, searched in the browser; to play an album, or everything at random. Only
	 * on this device (not the house's speakers), and without Modo DJ.
	 */
	let { data }: PageProps = $props();

	const VIEW_KEY = 'nube:own-music-view';
	function storedView(): 'albums' | 'artists' {
		try {
			return localStorage.getItem(VIEW_KEY) === 'artists' ? 'artists' : 'albums';
		} catch {
			return 'albums';
		}
	}
	let view = $state(storedView());
	function setView(value: 'albums' | 'artists') {
		view = value;
		try {
			localStorage.setItem(VIEW_KEY, value);
		} catch {
			// Private window: only forgotten.
		}
	}

	let search = $state('');
	const shown = $derived.by(() => {
		const words = fold(search).split(/\s+/).filter(Boolean);
		if (!words.length) return data.albums;
		const text = (a: OwnAlbumRow) =>
			fold([a.title, a.artist, ...a.tracks.flatMap((t) => [t.title, t.artist])].join(' '));
		return data.albums.filter((a) => words.every((w) => text(a).includes(w)));
	});
	const artists = $derived.by(() => {
		const by = new Map<string, { name: string; albums: OwnAlbumRow[] }>();
		for (const a of shown) {
			const key = fold(a.artist);
			const artist = by.get(key) ?? { name: a.artist, albums: [] };
			artist.albums.push(a);
			by.set(key, artist);
		}
		return [...by.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
	});

	/** «Todo aleatorio»: everything this browser plays, shuffled (the first few hundred). */
	const playAll = () => {
		const all = mixed(data.albums.flatMap(playableTracks)).slice(0, 500);
		if (all.length) void musicTarget.play(all, 0, false);
	};

	// Reading the bucket: how far, every few seconds, until it ends.
	$effect(() => {
		if (!data.source?.scanning) return;
		const every = setInterval(() => void invalidateAll(), 3000);
		return () => clearInterval(every);
	});
</script>

<svelte:head>
	<title>Tu música · Seilide</title>
</svelte:head>

{#snippet albumCard(a: OwnAlbumRow)}
	<a href={ownAlbumUrl(a.id)} class="group block min-w-0">
		{#if a.hasCover}
			<img
				src={ownCoverUrl(a.id)}
				alt=""
				loading="lazy"
				class="aspect-square w-full rounded-md bg-zinc-800 object-cover group-hover:opacity-80"
			/>
		{:else}
			<span
				class="flex aspect-square w-full items-center justify-center rounded-md bg-zinc-800 text-4xl text-zinc-600 group-hover:opacity-80"
				aria-hidden="true">♪</span
			>
		{/if}
		<span class="mt-2 block truncate text-sm font-medium">{a.title}</span>
		<span class="block truncate text-xs text-zinc-400">{a.artist}</span>
	</a>
{/snippet}

{#if !data.source}
	<div class="rounded-md border border-zinc-800 p-6 text-sm text-zinc-300">
		<p class="mb-2">
			Aquí sale la música que tengáis en vuestro propio almacenamiento (S3, R2, Backblaze…), sin
			subirla a ningún sitio.
		</p>
		{#if data.admin}
			<p>
				Conéctalo en <a
					href="/ajustes?seccion=conexiones#tu-musica"
					class="text-amber-400 underline">Ajustes → Conexiones → Tu música</a
				>.
			</p>
		{:else}
			<p class="text-zinc-400">Quien administra la familia lo conecta en Ajustes.</p>
		{/if}
	</div>
{:else}
	{#if data.admin}
		<p class="mb-3 text-right text-sm">
			<a href="/musica/tu-musica/gestion" class="text-zinc-400 hover:text-white">⚙ Gestión</a>
		</p>
	{/if}
	{#if data.source.scanning}
		<p class="mb-4 text-sm text-zinc-400" role="status">
			{#if data.source.phase === 'portadas'}
				Buscando portadas… {data.source.coversDone} de {data.source.coversTotal}
			{:else}
				Buscando música… {data.source.total
					? `${data.source.done.toLocaleString('es-ES')} de ${data.source.total.toLocaleString('es-ES')}`
					: ''}
			{/if}
		</p>
	{:else if data.source.problem}
		<p class="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
			Al leer vuestro almacenamiento: {data.source.problem}.
		</p>
	{/if}

	{#if data.albums.length}
		<div class="mb-6 flex flex-wrap items-center gap-3">
			<input
				type="search"
				bind:value={search}
				placeholder="Buscar álbum, artista o canción"
				class="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm sm:w-auto sm:min-w-0 sm:flex-1"
			/>
			<div class="flex overflow-hidden rounded-md border border-zinc-700 text-sm">
				<button
					class={['px-3 py-1.5', view === 'albums' ? 'bg-zinc-700' : 'hover:bg-zinc-800']}
					aria-pressed={view === 'albums'}
					onclick={() => setView('albums')}>Álbumes</button
				>
				<button
					class={['px-3 py-1.5', view === 'artists' ? 'bg-zinc-700' : 'hover:bg-zinc-800']}
					aria-pressed={view === 'artists'}
					onclick={() => setView('artists')}>Artistas</button
				>
			</div>
			<button
				class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
				onclick={playAll}>🔀 Todo aleatorio</button
			>
		</div>

		{#if !shown.length}
			<p class="text-sm text-zinc-400">Nada con «{search}».</p>
		{:else if view === 'albums'}
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
				{#each shown as a (a.id)}
					{@render albumCard(a)}
				{/each}
			</div>
		{:else}
			{#each artists as artist (artist.name)}
				<h2 class="mt-6 mb-3 font-semibold">{artist.name}</h2>
				<div class="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
					{#each artist.albums as a (a.id)}
						{@render albumCard(a)}
					{/each}
				</div>
			{/each}
		{/if}
	{:else if !data.source.scanning}
		<p class="text-sm text-zinc-400">
			No hay música en <span class="text-zinc-200">{data.source.label}</span>: mp3, m4a, flac, ogg,
			opus o wav, en esa carpeta o dentro de otras.
		</p>
	{/if}
{/if}
