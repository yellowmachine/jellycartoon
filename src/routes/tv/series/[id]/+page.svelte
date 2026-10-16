<script lang="ts">
	import TvEpisode from '#lib/components/TvEpisode.svelte';
	import { formatDuration } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.title} · JellyCartoon</title>
</svelte:head>

<h1 class="mb-8 text-4xl font-bold">{data.title}</h1>

{#if form && 'message' in form}
	<p class="mb-8 rounded-lg bg-red-950 p-4 text-red-200">{form.message}</p>
{/if}

{#if data.next}
	<div class="mb-12 w-1/2">
		<p class="mb-3 text-3xl font-semibold text-amber-400">
			{data.started ? 'Seguir' : 'Empezar'}
		</p>
		<TvEpisode
			id={data.next.id}
			heading="T{data.next.season} E{data.next.number} · {data.next.title}"
			detail={formatDuration(data.next.durationSec)}
			positionSec={data.next.positionSec}
			durationSec={data.next.durationSec}
		/>
	</div>
{/if}

<h2 class="mb-4 text-3xl font-semibold">Capítulos</h2>
<div class="grid grid-cols-4 gap-8">
	{#each data.episodes as ep (ep.id)}
		<TvEpisode
			id={ep.id}
			heading="T{ep.season} E{ep.number} · {ep.title}"
			detail={formatDuration(ep.durationSec)}
			positionSec={ep.positionSec}
			durationSec={ep.durationSec}
			completed={ep.completed}
		/>
	{/each}
</div>
