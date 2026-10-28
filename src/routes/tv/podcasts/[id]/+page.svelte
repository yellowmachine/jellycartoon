<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import TvHeader from '#lib/components/TvHeader.svelte';
	import { formatDuration } from 'comun/format.ts';
	import { music } from 'comun/music-player.svelte.ts';
	import { playEpisode } from 'comun/podcast-player.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const podcast = $derived(data.podcast);
	let playError = $state<string | null>(null);
	/** Long feeds: the newest first, and the rest on asking. */
	const PAGE = 30;
	let shown = $state(PAGE);

	const day = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });

	/** On the TV's speakers; OK on the one that is on pauses it and goes on. */
	async function play(id: number) {
		if (music.podcast?.id === id) return music.toggle();
		playError = await playEpisode(id);
	}

	// What was listened to while on this page, when it closes or changes, as on the app's own.
	let lastEpisode = $state<number | null>(null);
	$effect(() => {
		const id = music.podcast?.id ?? null;
		if (lastEpisode !== null && id !== lastEpisode) void invalidateAll();
		lastEpisode = id;
	});
</script>

<svelte:head>
	<title>{podcast.title} · Podcasts · JellyCartoon</title>
</svelte:head>

<TvHeader title={podcast.title} />

{#if playError}
	<p class="mb-8 rounded-lg bg-red-950 p-4 text-red-200">{playError}</p>
{/if}

<div class="grid grid-cols-4 gap-12">
	<div>
		{#if podcast.imageUrl}
			<img
				src={podcast.imageUrl}
				alt=""
				class="aspect-square w-full rounded-2xl bg-zinc-800 object-cover shadow-2xl"
			/>
		{/if}
		{#if podcast.author}<p class="mt-4 text-zinc-400">{podcast.author}</p>{/if}
		<p class="mt-1 text-xl text-zinc-500">{podcast.episodes.length} episodios</p>
	</div>

	<ol class="col-span-3 space-y-3">
		{#each podcast.episodes.slice(0, shown) as episode (episode.id)}
			{@const on = music.podcast?.id === episode.id}
			{@const started = !episode.completed && (episode.positionSec ?? 0) > 5}
			<li>
				<button
					class={[
						'w-full rounded-2xl border-2 px-6 py-4 text-left transition duration-150 focus-visible:scale-[1.02]',
						on
							? 'border-amber-400 bg-amber-500/15'
							: 'border-white/10 bg-zinc-900 focus-visible:bg-zinc-800'
					]}
					onclick={() => play(episode.id)}
				>
					<span
						class={[
							'block truncate text-3xl font-semibold',
							on && 'text-amber-300',
							episode.completed && !on && 'text-zinc-500'
						]}>{episode.title}</span
					>
					<span class="mt-1 block text-xl text-zinc-400">
						{#if on}
							{music.playing ? '● Sonando · OK para pausar' : 'En pausa · OK para seguir'}
						{:else}
							{#if episode.publishedAt}{day.format(new Date(episode.publishedAt))}{/if}
							{#if episode.durationSec}
								· {formatDuration(episode.durationSec)}{/if}
							{#if episode.completed}
								· Escuchado
							{:else if started}
								· <span class="text-amber-300">Vas por {formatDuration(episode.positionSec)}</span>
							{/if}
						{/if}
					</span>
					{#if started && episode.durationSec && !on}
						<span class="mt-2 block h-1.5 overflow-hidden rounded-full bg-white/15">
							<span
								class="block h-full bg-amber-400"
								style:width="{Math.min(100, (episode.positionSec! / episode.durationSec) * 100)}%"
							></span>
						</span>
					{/if}
				</button>
			</li>
		{/each}
		{#if podcast.episodes.length > shown}
			<li>
				<button
					class="rounded-full border-2 border-white/10 bg-zinc-900 px-8 py-3 text-2xl transition duration-150 focus-visible:scale-105 focus-visible:bg-zinc-800"
					onclick={() => (shown += PAGE)}
					>Ver más ({podcast.episodes.length - shown} más antiguos)</button
				>
			</li>
		{/if}
	</ol>
</div>
