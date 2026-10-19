<script lang="ts">
	import TvHeader from '#lib/components/TvHeader.svelte';
	import SectionIcon from '#lib/components/SectionIcon.svelte';
	import { formatDuration } from '#lib/format.ts';
	import { music } from '#lib/music-player.svelte.ts';
	import { playEpisode } from '#lib/podcast-player.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let playError = $state<string | null>(null);
	const day = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });

	/** On the TV's speakers; OK on the one that is on pauses it and goes on. */
	async function play(id: number) {
		if (music.podcast?.id === id) return music.toggle();
		playError = await playEpisode(id);
	}
</script>

<svelte:head>
	<title>Podcasts · JellyCartoon</title>
</svelte:head>

<TvHeader title="Podcasts" />

{#if playError}
	<p class="mb-8 rounded-lg bg-red-950 p-4 text-red-200">{playError}</p>
{/if}

{#if data.inProgress.length}
	<section class="mb-12">
		<h2 class="mb-4 text-3xl font-semibold">Seguir escuchando</h2>
		<div class="grid grid-cols-3 gap-6">
			{#each data.inProgress as episode (episode.id)}
				{@const on = music.podcast?.id === episode.id}
				<button
					class={[
						'flex items-center gap-5 rounded-2xl border-2 p-5 text-left transition duration-150 focus-visible:scale-105',
						on
							? 'border-amber-400 bg-amber-500/15'
							: 'border-white/10 bg-zinc-900 focus-visible:bg-zinc-800'
					]}
					onclick={() => play(episode.id)}
				>
					{#if episode.imageUrl}
						<img
							src={episode.imageUrl}
							alt=""
							class="h-20 w-20 shrink-0 rounded-xl bg-zinc-800 object-cover"
						/>
					{/if}
					<span class="min-w-0">
						<span class={['block truncate text-3xl font-semibold', on && 'text-amber-300']}
							>{episode.title}</span
						>
						<span class="block truncate text-xl text-zinc-400">{episode.podcastTitle}</span>
						<span class="block text-lg text-zinc-500">
							{#if on}
								{music.playing ? '● Sonando · OK para pausar' : 'En pausa · OK para seguir'}
							{:else}
								Vas por {formatDuration(episode.positionSec)}{episode.durationSec
									? ` de ${formatDuration(episode.durationSec)}`
									: ''}
							{/if}
						</span>
					</span>
				</button>
			{/each}
		</div>
	</section>
{/if}

<section>
	<h2 class="mb-4 text-3xl font-semibold">Tus podcasts</h2>
	{#if !data.podcasts.length}
		<p class="text-zinc-400">
			Todavía no sigues ninguno. Búscalos desde el móvil o el ordenador, en Radio → Podcasts.
		</p>
	{/if}
	<div class="grid grid-cols-6 gap-8">
		{#each data.podcasts as p (p.id)}
			<a
				href="/tv/podcasts/{p.id}"
				class="group block rounded-lg transition-transform duration-150 focus-visible:scale-105"
			>
				<div class="aspect-square overflow-hidden rounded-lg bg-zinc-800">
					{#if p.imageUrl}
						<img src={p.imageUrl} alt="" loading="lazy" class="h-full w-full object-cover" />
					{:else}
						<span class="flex h-full items-center justify-center text-zinc-600"
							><SectionIcon name="podcasts" class="h-1/3 w-1/3" /></span
						>
					{/if}
				</div>
				<p class="mt-2 truncate font-semibold group-focus-visible:text-amber-300">{p.title}</p>
				<p class="truncate text-xl text-zinc-400">
					{p.latestAt ? `Último: ${day.format(new Date(p.latestAt))}` : (p.author ?? '')}
				</p>
			</a>
		{/each}
	</div>
</section>
