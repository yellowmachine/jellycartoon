<script lang="ts">
	import { afterNavigate, invalidateAll } from '$app/navigation';
	import MusicBar from '#lib/components/MusicBar.svelte';
	import { music } from '#lib/music-player.svelte.ts';

	let { children } = $props();
	let main = $state<HTMLElement>();

	// The remote needs something with the focus to start from: the first tile.
	afterNavigate(() => main?.querySelector<HTMLElement>('a, button')?.focus());
</script>

<!-- Back from mpv (the window gets the focus again): what was watched moved on. -->
<svelte:window onfocus={() => invalidateAll()} />

<main bind:this={main} class="min-h-screen px-12 py-10 text-2xl">
	{@render children()}
</main>

<!-- The radio sounds through its <audio>; its bar is for the whole app, not for the TV. -->
<div class="hidden"><MusicBar /></div>

{#if music.radio}
	<!-- Wherever you are, that the radio is on. -->
	<p
		class="fixed right-8 bottom-8 flex items-center gap-3 rounded-full border border-emerald-400/40 bg-zinc-900/90 px-6 py-3 text-xl shadow-lg backdrop-blur"
	>
		<span class="h-3 w-3 animate-pulse rounded-full bg-emerald-400"></span>
		{music.radio.name}
	</p>
{/if}
