<script lang="ts">
	import { afterNavigate, goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import MusicBar from '#lib/components/MusicBar.svelte';
	import TvDebug from '#lib/components/TvDebug.svelte';
	import TvSalonFailed from '#lib/components/TvSalonFailed.svelte';
	import TvVoice from '#lib/components/TvVoice.svelte';
	import { music } from '#lib/music-player.svelte.ts';
	import { watchSalon } from '#lib/salon.svelte.ts';
	import { videoHere } from '#lib/video-here.svelte.ts';
	import { voice } from '#lib/voice-client.svelte.ts';

	let { children } = $props();
	let main = $state<HTMLElement>();
	const salon = watchSalon();

	/**
	 * The remote's keys that Chromium does not get as they are, remapped by udev (the README's
	 * «Mando del salón»): F7 its Home, F8 its Play/Pause, F9 its microphone. Its OK is Enter and its
	 * Back the browser's, which need nothing here.
	 */
	function remoteKey(e: KeyboardEvent) {
		if (e.key === 'F7') {
			e.preventDefault();
			void goto('/tv');
		} else if (e.key === 'F8') {
			e.preventDefault();
			// What is on: the living room's mpv first, then what sounds in this browser.
			const mpv = salon.state;
			if (mpv?.active) void salon.send({ action: 'pause', value: !mpv.paused });
			else if (music.radio || music.podcast || music.current) music.toggle();
			else videoHere.toggle();
		} else if (e.key === 'F9' && page.data.voice) {
			e.preventDefault();
			// The remote sends its microphone key pressed and let go at once: a tap to start, another
			// to send, whatever this device's setting is.
			if (!e.repeat) voice.toggle();
		}
	}

	/**
	 * What gets the focus, in the middle of the screen. Chromium's spatial navigation only moves to
	 * what is in view: with the next row below the screen, an arrow press scrolled the page and
	 * only the next one moved the focus.
	 */
	function centerFocus(e: FocusEvent) {
		if (e.target instanceof HTMLElement && main?.contains(e.target))
			e.target.scrollIntoView({ block: 'center' });
	}

	// The remote needs something with the focus to start from: the first tile, or the one the page
	// marks.
	afterNavigate(() =>
		(main?.querySelector<HTMLElement>('[data-focus]') ?? main?.querySelector('a, button'))?.focus()
	);

	/** A song, or a podcast episode: the same bar, to the same controls. */
	const playing = $derived(
		music.podcast
			? { text: `${music.podcast.title} · ${music.podcast.podcastTitle}`, podcast: true }
			: !music.radio && music.current
				? { text: `${music.current.title} · ${music.current.artist}`, podcast: false }
				: null
	);
</script>

<!-- Back from mpv (the window gets the focus again): what was watched moved on. -->
<svelte:window onfocus={() => invalidateAll()} onkeydown={remoteKey} />
<svelte:document onfocusin={centerFocus} />

<main bind:this={main} class="min-h-screen px-12 py-10 text-2xl">
	{@render children()}
</main>

{#if page.data.salon}
	<TvSalonFailed />
{/if}

{#if page.data.voice}
	<TvVoice />
{/if}

<TvDebug />

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
{:else if playing && page.url.pathname !== '/tv/sonando'}
	<!-- And what song or episode: a link to its controls, the remote gets there with the arrows. -->
	<a
		href="/tv/sonando"
		class={[
			'fixed right-8 bottom-8 flex max-w-xl items-center gap-3 rounded-full border bg-zinc-900/90 px-6 py-3 text-xl shadow-lg backdrop-blur transition duration-150 focus-visible:scale-105',
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
