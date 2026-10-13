<script lang="ts">
	import MiniSearch from 'minisearch';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import AlbumCover from '#lib/components/AlbumCover.svelte';
	import { formatDuration } from '#lib/format.ts';
	import type { MusicAlbum, MusicTrack } from '#lib/music.ts';
	import { music } from '#lib/music-player.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let search = $state('');
	let scanning = $state(false);

	// While tags are being read, the page fills in by itself.
	$effect(() => {
		if (data.pending === 0) return;
		const timer = setInterval(() => invalidateAll(), 3000);
		return () => clearInterval(timer);
	});

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
		music.play(
			a.tracks,
			a.tracks.findIndex((x) => x.id === t.id)
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
	<form
		method="post"
		action="?/scan"
		use:enhance={() => {
			scanning = true;
			return async ({ update }) => {
				await update();
				scanning = false;
			};
		}}
	>
		<button
			disabled={scanning}
			class="rounded-md bg-amber-500 px-3 py-1 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
		>
			{scanning ? 'Escaneando…' : 'Escanear carpeta'}
		</button>
	</form>
</div>

{#if form && 'message' in form && form.message}
	<p class="-mt-4 mb-4 text-sm text-red-400">{form.message}</p>
{/if}
{#if form && 'scan' in form && form.scan}
	<p class="-mt-4 mb-4 text-sm text-zinc-400">
		{form.scan.added} nuevas · {form.scan.changed} cambiadas · {form.scan.missing} desaparecidas
		{#if form.scan.waiting}
			<br />{form.scan.waiting} aún se están copiando: vuelve a escanear en un minuto.
		{/if}
	</p>
{/if}
{#if data.pending}
	<p class="mb-4 text-sm text-amber-400">
		Leyendo etiquetas: quedan {data.pending}. Luego se buscan las portadas en MusicBrainz.
	</p>
{/if}

{#if data.albums.length === 0}
	{#if !data.pending}
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
				<li>
					<button
						class={[
							'flex w-full items-center gap-3 p-2 text-left hover:bg-zinc-900',
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
