<script lang="ts">
	import MusicBackground from 'comun/components/MusicBackground.svelte';
	import TvHeader from '#lib/components/TvHeader.svelte';
	import TvTracks from '#lib/components/TvTracks.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.name} · JellyCartoon</title>
</svelte:head>

<MusicBackground snapcast={false} />

<TvHeader title={data.name} />

{#if !data.tracks.length}
	<p class="text-zinc-400">Esta lista está vacía.</p>
{:else}
	<TvTracks tracks={data.tracks} artists />
{/if}
