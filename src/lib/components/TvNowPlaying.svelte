<script lang="ts">
	import { page } from '$app/state';
	import { music } from 'comun/music-player.svelte.ts';

	/**
	 * In each TV page's header, beside the time: the radio that is on, or the song or podcast
	 * episode playing, a link to its controls (/tv/sonando) that the remote reaches going up.
	 */
	const playing = $derived(
		music.podcast
			? { text: `${music.podcast.title} · ${music.podcast.podcastTitle}`, podcast: true }
			: !music.radio && music.current
				? { text: `${music.current.title} · ${music.current.artist}`, podcast: false }
				: null
	);
</script>

{#if music.radio}
	<p
		class="flex min-w-0 items-center gap-3 rounded-full border border-emerald-400/40 bg-zinc-900/90 px-6 py-3 text-xl"
	>
		<span class="h-3 w-3 shrink-0 animate-pulse rounded-full bg-emerald-400"></span>
		<span class="truncate">{music.radio.name}</span>
	</p>
{:else if playing && page.url.pathname !== '/tv/sonando'}
	<a
		href="/tv/sonando"
		class={[
			'flex max-w-xl min-w-0 items-center gap-3 rounded-full border bg-zinc-900/90 px-6 py-3 text-xl transition duration-150 focus-visible:scale-105',
			playing.podcast
				? 'border-amber-400/40 focus-visible:border-amber-300'
				: 'border-violet-400/40 focus-visible:border-violet-300'
		]}
	>
		<span
			class={[
				'h-3 w-3 shrink-0 rounded-full',
				!music.playing
					? 'bg-zinc-500'
					: playing.podcast
						? 'animate-pulse bg-amber-400'
						: 'animate-pulse bg-violet-400'
			]}
		></span>
		<span class="truncate">{playing.text}</span>
	</a>
{/if}
