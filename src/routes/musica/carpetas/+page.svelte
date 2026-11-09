<script lang="ts">
	import MusicFolderView from 'comun/components/MusicFolderView.svelte';
	import MusicTargetSwitch from '#lib/components/MusicTargetSwitch.svelte';
	import { musicTarget } from 'comun/music-target.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Only where Snapcast is set up; elsewhere, always this device. */
	const toSnapcast = $derived(Boolean(data.snapcast) && musicTarget.value === 'snapcast');
</script>

<svelte:head>
	<title>{data.folder.path ? data.folder.name : 'Carpetas'} · JellyCartoon</title>
</svelte:head>

<MusicFolderView folder={data.folder} playlists={data.playlists} {toSnapcast}>
	{#snippet extra()}
		{#if data.snapcast}<MusicTargetSwitch />{/if}
	{/snippet}
</MusicFolderView>
