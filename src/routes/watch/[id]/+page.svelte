<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import EpisodeCard from 'comun/components/EpisodeCard.svelte';
	import Player from 'comun/components/Player.svelte';
	import EpisodePreview from '#lib/components/EpisodePreview.svelte';
	import PlayerFrame from '#lib/components/PlayerFrame.svelte';
	import PlayerListen from '#lib/components/PlayerListen.svelte';
	import { houseLinks, outOfTime, playsAtHome } from '#lib/house-player.ts';
	import { ANSWER_SECONDS, QUESTION } from '#lib/still-there.ts';
	import { stillThere } from '#lib/still-there.svelte.ts';
	import { videoHere } from '#lib/video-here.svelte.ts';
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

	/** `byItself`: the countdown ended, nobody chose it. */
	function playNext(byItself = false) {
		stopCountdown();
		if (!data.nextId) return;
		if (byItself) stillThere.startedByItself();
		void goto(`/watch/${data.nextId}`);
	}

	/**
	 * «¿Sigues ahí?» (#77): this one waits, unstarted, when enough came by themselves with nobody
	 * touching anything; without an answer in time it stays stopped (`stopped`). Each episode's
	 * page decides it once, as it opens.
	 */
	let asking = $derived(
		data.askEvery !== null && untrack(() => stillThere.unattended) >= data.askEvery
	);
	let stopped = $state(false);

	function tell(state: 'asking' | 'answered' | 'stopped') {
		void fetch('/api/sigues-ahi', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ state })
		}).catch(() => {});
	}

	$effect(() => {
		if (!asking) return;
		stopped = false;
		tell('asking');
		// Over the native fullscreen nothing shows: out of it, to see the question.
		if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
		const timer = setTimeout(() => {
			stopped = true;
			tell('stopped');
		}, ANSWER_SECONDS * 1000);
		return () => clearTimeout(timer);
	});

	/** «Sigo aquí»: it plays. `play`: false when it was already started some other way. */
	function answer(play = true) {
		stillThere.someoneThere();
		asking = false;
		stopped = false;
		tell('answered');
		if (play) void videoHere.current?.element.play().catch(() => {});
	}

	// Started from the player's own controls: that is an answer too.
	$effect(() => {
		if (asking && videoHere.playing) untrack(() => answer(false));
	});

	/** A touch, a click or a key on this page: someone is there. */
	function someoneThere() {
		stillThere.someoneThere();
	}

	/**
	 * Ended with «siguiente automático»: the next one's card over the video, counting down. In
	 * fullscreen (the browser's own, nothing can go over it) it starts at once, as before.
	 */
	function ended(next: boolean) {
		if (!next || !data.nextId) return;
		if (document.fullscreenElement) return playNext(true);
		countdown = COUNTDOWN;
		timer = setInterval(() => {
			if (countdown === null) return;
			countdown -= 1;
			if (countdown <= 0) playNext(true);
		}, 1000);
	}

	// Another episode (the next one, or one picked below): no countdown left from this one.
	$effect(() => {
		void data.episode.id;
		return stopCountdown;
	});
</script>

{#snippet preview(ep: { id: number; durationSec: number | null })}
	<EpisodePreview id={ep.id} durationSec={ep.durationSec} />
{/snippet}

{#snippet upNext()}
	{#if data.next}
		<div class="w-full max-w-xs text-center">
			<p class="mb-3 text-lg font-semibold">Siguiente en {countdown} s</p>
			<EpisodeCard episode={data.next} {preview} />
			<div class="mt-4 flex justify-center gap-3">
				<button
					class="rounded-md bg-amber-500 px-4 py-2 font-medium text-zinc-950 hover:bg-amber-400"
					onclick={() => playNext()}>Ver ahora</button
				>
				<button
					class="rounded-md border border-zinc-600 px-4 py-2 hover:bg-zinc-800"
					onclick={stopCountdown}>Cancelar</button
				>
			</div>
		</div>
	{/if}
{/snippet}

{#snippet question()}
	<div class="w-full max-w-sm text-center">
		<p class="mb-2 text-2xl font-semibold">{stopped ? 'Se ha parado' : QUESTION}</p>
		<p class="mb-5 text-zinc-300">
			{stopped
				? 'Nadie contestó, así que no ha seguido.'
				: 'Llevas varios capítulos seguidos sin tocar nada.'}
		</p>
		<button
			class="rounded-md bg-amber-500 px-5 py-2.5 text-lg font-medium text-zinc-950 hover:bg-amber-400"
			onclick={() => answer()}>{stopped ? 'Seguir viendo' : 'Sí, sigo aquí'}</button
		>
	</div>
{/snippet}

<svelte:window onpointerdown={someoneThere} onkeydown={someoneThere} />

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
	autoplay={!asking}
	overlay={asking ? question : countdown !== null ? upNext : undefined}
	links={houseLinks(data.episode.id)}
	here={playsAtHome(
		data.episode.id,
		`${data.episode.seriesTitle} · T${data.episode.season} E${data.episode.number} · ${data.episode.title}`
	)}
	onrefused={outOfTime}
>
	{#snippet menuTop(menu)}<PlayerListen {menu} />{/snippet}
	{#snippet menuBottom(menu)}<PlayerFrame {menu} langua={data.langua} />{/snippet}
</Player>

<!-- What comes after: the next one with «siguiente automático»; without it, others to go on with. -->
{#if autoNext}
	{#if data.next}
		<section class="mt-6 max-w-xs">
			<EpisodeCard episode={data.next} label="A continuación" {preview} />
		</section>
	{/if}
{:else if data.next || data.suggestions.length}
	<section class="mt-6">
		<h2 class="mb-3 text-sm tracking-wide text-zinc-400 uppercase">Para seguir</h2>
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
			{#if data.next}
				<EpisodeCard episode={data.next} label="Siguiente" {preview} />
			{/if}
			{#each data.suggestions as suggestion (suggestion.id)}
				<EpisodeCard episode={suggestion} label="Te puede gustar" {preview} />
			{/each}
		</div>
	</section>
{/if}
