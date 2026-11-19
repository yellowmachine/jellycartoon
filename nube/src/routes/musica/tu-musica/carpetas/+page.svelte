<script lang="ts">
	import MusicFolderView from 'comun/components/MusicFolderView.svelte';
	import { asTrack, OWN_LISTS_API, ownFolderUrl, playable } from '#lib/own-music.ts';
	import { vista } from '#lib/vista.svelte.ts';
	import type { PageProps } from './$types';

	/**
	 * Música → Carpetas from the family's own bucket (#534, phase 3): as the house's, only on this
	 * device, with what this browser plays.
	 */
	let { data }: PageProps = $props();

	const folder = $derived({
		...data.folder,
		tracks: data.folder.tracks.filter((t) => playable(t.mime)).map((t) => asTrack(t, t.album))
	});
</script>

<svelte:head>
	<title>{folder.path ? folder.name : 'Carpetas'} · Seilide</title>
</svelte:head>

<MusicFolderView
	{folder}
	playlists={vista.kiosk ? [] : data.playlists}
	toSnapcast={false}
	href={ownFolderUrl}
	listEndpoint={OWN_LISTS_API}
/>
