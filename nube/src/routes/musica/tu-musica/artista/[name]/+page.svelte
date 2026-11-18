<script lang="ts">
	import AlbumGrid from 'comun/components/AlbumGrid.svelte';
	import TrackRows from 'comun/components/TrackRows.svelte';
	import { musicTarget } from 'comun/music-target.svelte.ts';
	import { asAlbum, OWN_LISTS_API } from '#lib/own-music.ts';
	import { vista } from '#lib/vista.svelte.ts';
	import type { PageProps } from './$types';

	/** An artist of «Tu música» (#534), as the house's: their albums, and their songs in others'. */
	let { data }: PageProps = $props();

	const albums = $derived(data.albums.map(asAlbum));
	const appearsOn = $derived(data.appearsOn.map(asAlbum).flatMap((a) => a.tracks));
</script>

<svelte:head>
	<title>{data.name} · Seilide</title>
</svelte:head>

<a href="/musica/tu-musica" class="text-sm text-zinc-400 hover:text-white">← Tu música</a>

<h1 class="mt-3 text-2xl font-bold">{data.name}</h1>
<p class="mb-6 text-sm text-zinc-400">
	{albums.length === 1 ? '1 álbum' : `${albums.length} álbumes`}
	{#if appearsOn.length}
		· {appearsOn.length === 1 ? '1 canción' : `${appearsOn.length} canciones`} en otros discos
	{/if}
</p>

{#if albums.length}
	<AlbumGrid {albums} />
{/if}

{#if appearsOn.length}
	<h2 class="mt-8 mb-3 text-lg font-semibold">También aparece en</h2>
	<!-- Played one after another, from the one clicked on. -->
	<TrackRows
		tracks={appearsOn}
		key="appears"
		playlists={vista.kiosk ? null : data.ownLists}
		listEndpoint={OWN_LISTS_API}
		onplay={(_, i) => musicTarget.play(appearsOn, i, false)}
	/>
{/if}
