<script lang="ts">
	import MusicFolderView from 'comun/components/MusicFolderView.svelte';
	import type { PageProps } from './$types';

	/** As jellycartoon's: without its speakers here, only this device. */
	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.folder.path ? data.folder.name : 'Carpetas'} · Seilide</title>
</svelte:head>

<MusicFolderView folder={data.folder} playlists={data.playlists} toSnapcast={false} />
