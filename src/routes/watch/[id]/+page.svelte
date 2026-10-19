<script lang="ts">
	import { goto } from '$app/navigation';
	import EpisodeCard from '#lib/components/EpisodeCard.svelte';
	import Player from '#lib/components/Player.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Seconds the next episode's card waits over the video, when this one ends. */
	const COUNTDOWN = 8;

	/** As chosen under the video; from the user's settings at first. */
	let autoNext = $derived(data.settings.autoNext);
	/** Seconds left before the next one starts by itself; null: no countdown. */
	let countdown = $state<number | null>(null);
	let timer: ReturnType<typeof setInterval> | undefined;

	function stopCountdown() {
		clearInterval(timer);
		countdown = null;
	}

	function playNext() {
		stopCountdown();
		if (data.nextId) void goto(`/watch/${data.nextId}`);
	}

	/**
	 * Ended with «siguiente automático»: the next one's card over the video, counting down. In
	 * fullscreen (the browser's own, nothing can go over it) it starts at once, as before.
	 */
	function ended(next: boolean) {
		if (!next || !data.nextId) return;
		if (document.fullscreenElement) return playNext();
		countdown = COUNTDOWN;
		timer = setInterval(() => {
			if (countdown === null) return;
			countdown -= 1;
			if (countdown <= 0) playNext();
		}, 1000);
	}

	// Another episode (the next one, or one picked below): no countdown left from this one.
	$effect(() => {
		void data.episode.id;
		return stopCountdown;
	});
</script>

{#snippet upNext()}
	{#if data.next}
		<div class="w-full max-w-xs text-center">
			<p class="mb-3 text-lg font-semibold">Siguiente en {countdown} s</p>
			<EpisodeCard episode={data.next} />
			<div class="mt-4 flex justify-center gap-3">
				<button
					class="rounded-md bg-amber-500 px-4 py-2 font-medium text-zinc-950 hover:bg-amber-400"
					onclick={playNext}>Ver ahora</button
				>
				<button
					class="rounded-md border border-zinc-600 px-4 py-2 hover:bg-zinc-800"
					onclick={stopCountdown}>Cancelar</button
				>
			</div>
		</div>
	{/if}
{/snippet}

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
	title="{data.episode.seriesTitle} · T{data.episode.season} E{data.episode.number} · {data.episode
		.title}"
	startAt={data.episode.positionSec}
	audioTracks={data.episode.audioTracks}
	subtitles={data.episode.subtitles}
	settings={data.settings}
	onended={ended}
	onautonextchange={(value) => (autoNext = value)}
	overlay={countdown !== null ? upNext : undefined}
/>

<!-- What comes after: the next one with «siguiente automático»; without it, others to go on with. -->
{#if autoNext}
	{#if data.next}
		<section class="mt-6 max-w-xs">
			<EpisodeCard episode={data.next} label="A continuación" />
		</section>
	{/if}
{:else if data.next || data.suggestions.length}
	<section class="mt-6">
		<h2 class="mb-3 text-sm tracking-wide text-zinc-400 uppercase">Para seguir</h2>
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
			{#if data.next}
				<EpisodeCard episode={data.next} label="Siguiente" />
			{/if}
			{#each data.suggestions as suggestion (suggestion.id)}
				<EpisodeCard episode={suggestion} label="Te puede gustar" />
			{/each}
		</div>
	</section>
{/if}
