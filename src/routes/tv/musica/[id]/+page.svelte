<script lang="ts">
	import MusicBackground from '#lib/components/MusicBackground.svelte';
	import TvHeader from '#lib/components/TvHeader.svelte';
	import TvTracks from '#lib/components/TvTracks.svelte';
	import { formatRemaining } from 'comun/format.ts';
	import { coverUrl } from 'comun/music.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const album = $derived(data.album);
	const total = $derived(album.tracks.reduce((sum, t) => sum + (t.durationSec ?? 0), 0));
</script>

<svelte:head>
	<title>{album.title} · JellyCartoon</title>
</svelte:head>

<MusicBackground snapcast={false} />

<TvHeader title={album.title} />

<div class="grid grid-cols-3 gap-12">
	<div>
		{#if album.hasCover}
			<img
				src={coverUrl(album.id)}
				alt=""
				class="aspect-square w-full rounded-2xl object-cover shadow-2xl"
			/>
		{/if}
		<p class="mt-5 text-3xl font-semibold">{album.artist}</p>
		<p class="mt-1 text-xl text-zinc-400">
			{album.tracks.length}
			{album.tracks.length === 1 ? 'canción' : 'canciones'} · {formatRemaining(total)}
		</p>
	</div>
	<div class="col-span-2 min-w-0">
		<TvTracks tracks={album.tracks} />
	</div>
</div>
