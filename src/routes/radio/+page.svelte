<script lang="ts">
	import RadioStations from 'comun/components/RadioStations.svelte';
	import MusicTargetSwitch from '#lib/components/MusicTargetSwitch.svelte';
	import type { PageProps } from './$types';

	/**
	 * The stations, here too (#253): for the children (who have no account in the cloud), the TV and
	 * the whole house. The podcasts are only Seilide's.
	 */
	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Radio · JellyCartoon</title>
</svelte:head>

<div class="mb-4 flex flex-wrap items-center gap-3">
	<h1 class="mr-auto text-2xl font-bold">Radio</h1>
</div>
<RadioStations info={data.info} snapcast={data.snapcast}>
	{#snippet switcher()}
		<MusicTargetSwitch />
	{/snippet}
</RadioStations>
