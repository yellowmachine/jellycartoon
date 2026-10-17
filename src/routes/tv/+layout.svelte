<script lang="ts">
	import { afterNavigate, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import MusicBar from '#lib/components/MusicBar.svelte';
	import { music } from '#lib/music-player.svelte.ts';

	let { children } = $props();
	let main = $state<HTMLElement>();

	// The remote needs something with the focus to start from: the first tile, or the one the page
	// marks.
	afterNavigate(() =>
		(main?.querySelector<HTMLElement>('[data-focus]') ?? main?.querySelector('a, button'))?.focus()
	);

	const track = $derived(music.radio ? undefined : music.current);
</script>

<!-- Back from mpv (the window gets the focus again): what was watched moved on. -->
<svelte:window onfocus={() => invalidateAll()} />

<main bind:this={main} class="min-h-screen px-12 py-10 text-2xl">
	{@render children()}
</main>

<!-- The music sounds through its <audio>; its bar is for the whole app, not for the TV. -->
<div class="hidden"><MusicBar /></div>

{#if music.radio}
	<!-- Wherever you are, that the radio is on. -->
	<p
		class="fixed right-8 bottom-8 flex items-center gap-3 rounded-full border border-emerald-400/40 bg-zinc-900/90 px-6 py-3 text-xl shadow-lg backdrop-blur"
	>
		<span class="h-3 w-3 animate-pulse rounded-full bg-emerald-400"></span>
		{music.radio.name}
	</p>
{:else if track && page.url.pathname !== '/tv/sonando'}
	<!-- And what song: a link to its controls, the remote gets there with the arrows. -->
	<a
		href="/tv/sonando"
		class="fixed right-8 bottom-8 flex max-w-xl items-center gap-3 rounded-full border border-violet-400/40 bg-zinc-900/90 px-6 py-3 text-xl shadow-lg backdrop-blur transition duration-150 focus-visible:scale-105 focus-visible:border-violet-300"
	>
		<span
			class={[
				'h-3 w-3 shrink-0 rounded-full',
				music.playing ? 'animate-pulse bg-violet-400' : 'bg-zinc-500'
			]}
		></span>
		<span class="truncate">{track.title} · {track.artist}</span>
	</a>
{/if}
