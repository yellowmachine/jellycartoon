<script lang="ts">
	import type { Snippet } from 'svelte';
	import MiniSearch from 'minisearch';
	import AlbumCover from 'comun/components/AlbumCover.svelte';
	import AlbumGrid from 'comun/components/AlbumGrid.svelte';
	import TrackRows from 'comun/components/TrackRows.svelte';
	import {
		fold,
		groupByArtist,
		type MusicAlbum,
		type MusicArtist,
		type MusicTrack
	} from 'comun/music.ts';
	import { musicTarget } from 'comun/music-target.svelte.ts';

	/**
	 * A music library as Música shows it: its albums or its artists (on this device), and a search
	 * of artists, albums and songs in the browser. The house's (Álbumes, #253) and the family's own
	 * bucket's (Tu música, #534), each with what it adds on top (`actions`: Modo DJ, Gestión).
	 */
	interface Props {
		/** Null while they come. */
		albums: MusicAlbum[] | null;
		/** The title, at the top left. */
		title: Snippet;
		/** Beside the search: Modo DJ, Gestión… */
		actions?: Snippet;
		/** Under the top, before the albums: a notice. */
		notice?: Snippet;
		/** Its artists' pages. */
		artistHref: (name: string) => string;
		/** For the «+» of each song; without them, none. */
		playlists?: { id: number; name: string }[] | null;
		/** Where their «+» adds: the house's lists by default. */
		listEndpoint?: string;
		/** Albums or artists: remembered on this device, apart for each library. */
		viewKey: string;
		loading: string;
		failed?: string | null;
		empty: Snippet;
	}

	let {
		albums: catalog,
		title,
		actions,
		notice,
		artistHref,
		playlists = null,
		listEndpoint,
		viewKey,
		loading,
		failed = null,
		empty
	}: Props = $props();

	function storedView(): 'albums' | 'artists' {
		try {
			return localStorage.getItem(viewKey) === 'artists' ? 'artists' : 'albums';
		} catch {
			return 'albums';
		}
	}
	function saveView(value: 'albums' | 'artists') {
		try {
			localStorage.setItem(viewKey, value);
		} catch {
			// Private window: it is only forgotten.
		}
	}

	const albums = $derived(catalog ?? []);
	let search = $state('');
	let view = $state(storedView());
	const artists = $derived(groupByArtist(albums));

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
			...albums.map((a) => ({ id: `a${a.id}`, title: a.title, artist: a.artist })),
			...albums.flatMap((a) =>
				a.tracks.map((t) => ({ id: `t${t.id}`, title: t.title, artist: t.artist, album: a.title }))
			)
		]);
		return ms;
	});

	const albumsById = $derived(new Map(albums.map((a) => [a.id, a])));
	const tracksById = $derived(
		new Map(albums.flatMap((a) => a.tracks.map((t) => [t.id, t] as const)))
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
				found.push(artists[id]!);
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
			false
		);
	}
</script>

{#snippet artistGrid(artists: MusicArtist[])}
	<div class="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
		{#each artists as artist (artist.name)}
			{@const covered = artist.albums.filter((a) => a.hasCover || a.cover)}
			<a href={artistHref(artist.name)} class="group">
				<!-- With four covers or more, a mosaic of them; else the first one. -->
				{#if covered.length >= 4}
					<div class="grid grid-cols-2 overflow-hidden rounded-md group-hover:opacity-80">
						{#each covered.slice(0, 4) as a (a.id)}
							<AlbumCover album={a} class="w-full" />
						{/each}
					</div>
				{:else}
					<AlbumCover
						album={covered[0] ?? artist.albums[0]!}
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
	<h1 class="mr-auto text-2xl font-bold">{@render title()}</h1>
	{@render actions?.()}
	<input
		type="search"
		bind:value={search}
		placeholder="Artista, álbum o canción"
		aria-label="Buscar por artista, álbum o canción"
		class="w-56 rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm"
	/>
</div>

{@render notice?.()}

{#if !catalog}
	<p class="text-sm text-zinc-400">{failed ?? loading}</p>
{:else if albums.length === 0}
	{@render empty()}
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
			{playlists}
			{listEndpoint}
			onplay={(t) => playTrack(t)}
		/>
	{/if}
	{#if !results.artists.length && !results.albums.length && !results.tracks.length}
		<p class="text-zinc-400">Nada coincide con «{search}».</p>
	{/if}
{:else}
	<div class="mb-4 flex items-center justify-between gap-3">
		<p class="text-sm text-zinc-400">
			{view === 'artists' ? `${artists.length} artistas · ` : ''}{albums.length} álbumes
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
						saveView(value);
					}}>{label}</button
				>
			{/each}
		</div>
	</div>
	{#if view === 'artists'}
		{@render artistGrid(artists)}
	{:else}
		<AlbumGrid {albums} />
	{/if}
{/if}
