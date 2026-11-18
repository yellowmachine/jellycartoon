<script lang="ts">
	import { onMount } from 'svelte';
	import MusicBackground from 'comun/components/MusicBackground.svelte';
	import Sonando from 'comun/components/Sonando.svelte';
	import { music } from 'comun/music-player.svelte.ts';
	import { vista } from '#lib/vista.svelte.ts';

	/**
	 * What sounds, big, in the Vista (#525): /tv's «Sonando» (comun), the tablet's size, for a
	 * finger. The Música tab opens it while something plays; «Elegir música» goes to the albums.
	 */
	onMount(() => {
		vista.load();
		if (!vista.on) void vista.set(true);
	});
</script>

<svelte:head>
	<title>Sonando · Seilide</title>
</svelte:head>

<MusicBackground snapcast={false} />

<Sonando size="tablet" chooseHref="/musica" />

{#if (music.radio ? null : music.current) ?? music.podcast}
	<p class="mt-10">
		<a href="/musica" class="text-lg text-amber-400 hover:underline">Elegir otra música</a>
	</p>
{/if}
