<script lang="ts">
	import AlbumGrid from 'comun/components/AlbumGrid.svelte';
	import TrackRows from 'comun/components/TrackRows.svelte';
	import { musicTarget } from 'comun/music-target.svelte.ts';
	import type { PageProps } from './$types';

	/** An artist (#253), as jellycartoon's: their albums, and their songs in others'. */
	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.name} · Nube</title>
</svelte:head>

<a href="/musica" class="text-sm text-zinc-400 hover:text-white">← Música</a>

<h1 class="mt-3 text-2xl font-bold">{data.name}</h1>
<p class="mb-6 text-sm text-zinc-400">
	{data.albums.length === 1 ? '1 álbum' : `${data.albums.length} álbumes`}
	{#if data.appearsOn.length}
		· {data.appearsOn.length === 1 ? '1 canción' : `${data.appearsOn.length} canciones`} en otros discos
	{/if}
</p>

{#if data.albums.length}
	<AlbumGrid albums={data.albums} />
{/if}

{#if data.appearsOn.length}
	<h2 class="mt-8 mb-3 text-lg font-semibold">También aparece en</h2>
	<!-- Played one after another, from the one clicked on. -->
	<TrackRows
		tracks={data.appearsOn}
		key="appears"
		playlists={data.playlists}
		onplay={(_, i) => musicTarget.play(data.appearsOn, i, false)}
	/>
{/if}
