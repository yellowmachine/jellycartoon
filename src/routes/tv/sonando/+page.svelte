<script lang="ts">
	import MusicBackground from 'comun/components/MusicBackground.svelte';
	import Sonando from 'comun/components/Sonando.svelte';
	import TvHeader from '#lib/components/TvHeader.svelte';
	import { music } from 'comun/music-player.svelte.ts';

	/** What sounds on the TV, big, with its controls for the remote: a song or a podcast episode. */
	const playing = $derived(Boolean((music.radio ? undefined : music.current) ?? music.podcast));

	// Stopped, or at the end of the queue: the remote needs something with the focus again. And
	// the other way, when the queue comes back from the server after the page was opened.
	let choose = $state<HTMLElement>();
	let toggle = $state<HTMLElement>();
	$effect(() => {
		if (!playing) choose?.focus();
		else if (document.activeElement === document.body) toggle?.focus();
	});
</script>

<svelte:head>
	<title>Sonando · JellyCartoon</title>
</svelte:head>

<MusicBackground snapcast={false} />

<TvHeader plain />

<Sonando size="tv" chooseHref="/tv/musica" bind:toggle bind:choose />
