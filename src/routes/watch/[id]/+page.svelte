<script lang="ts">
	import { goto } from '$app/navigation';
	import Player from '#lib/components/Player.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<div class="mb-4">
	<a href="/series/{data.episode.seriesId}" class="text-sm text-zinc-400 hover:text-white">
		← {data.episode.seriesTitle}
	</a>
	<h1 class="text-xl font-semibold">
		T{data.episode.season} E{data.episode.number} · {data.episode.title}
	</h1>
</div>

<Player
	episodeId={data.episode.id}
	startAt={data.episode.positionSec}
	audioTracks={data.episode.audioTracks}
	subtitles={data.episode.subtitles}
	settings={data.settings}
	onended={() => data.nextId && goto(`/watch/${data.nextId}`)}
/>

{#if data.nextId}
	<div class="mt-4 text-right">
		<a href="/watch/{data.nextId}" class="text-sm text-amber-400 hover:underline">
			Siguiente episodio →
		</a>
	</div>
{/if}
