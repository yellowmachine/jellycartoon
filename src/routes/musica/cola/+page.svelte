<script lang="ts">
	import { page } from '$app/state';
	import MusicQueue from 'comun/components/MusicQueue.svelte';
	import { musicTarget } from 'comun/music-target.svelte.ts';
	import MusicTargetSwitch from '#lib/components/MusicTargetSwitch.svelte';
	import SnapcastQueue from '#lib/components/SnapcastQueue.svelte';

	/** Where Snapcast is set up, the queue of where it sounds: this device, or Snapcast's. */
	const snapcast = $derived(Boolean(page.data.snapcast));
</script>

<svelte:head>
	<title>Cola · Música</title>
</svelte:head>

{#snippet where()}
	{#if snapcast}
		<div class="my-3"><MusicTargetSwitch /></div>
	{/if}
{/snippet}

<!-- Música → Cola: what plays, what comes next and what already played. -->
{#if snapcast && musicTarget.value === 'snapcast'}
	<SnapcastQueue>{@render where()}</SnapcastQueue>
{:else}
	<MusicQueue>{@render where()}</MusicQueue>
{/if}
