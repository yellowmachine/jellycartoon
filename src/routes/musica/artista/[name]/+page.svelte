<script lang="ts">
	import AlbumGrid from 'comun/components/AlbumGrid.svelte';
	import MusicTargetSwitch from '#lib/components/MusicTargetSwitch.svelte';
	import TrackRows from 'comun/components/TrackRows.svelte';
	import { musicTarget } from 'comun/music-target.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Only where Snapcast is set up; elsewhere, always this device. */
	const toSnapcast = $derived(data.snapcast && musicTarget.value === 'snapcast');
</script>

<svelte:head>
	<title>{data.name} · JellyCartoon</title>
</svelte:head>

<a href="/musica" class="text-sm text-zinc-400 hover:text-white">← Música</a>

<h1 class="mt-3 text-2xl font-bold">{data.name}</h1>
<p class="mb-6 text-sm text-zinc-400">
	{data.albums.length === 1 ? '1 álbum' : `${data.albums.length} álbumes`}
	{#if data.appearsOn.length}
		· {data.appearsOn.length === 1 ? '1 canción' : `${data.appearsOn.length} canciones`} en otros discos
	{/if}
</p>

{#if data.snapcast}
	<div class="mb-6"><MusicTargetSwitch /></div>
{/if}

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
		onplay={(_, i) => musicTarget.play(data.appearsOn, i, toSnapcast)}
	/>
{/if}
