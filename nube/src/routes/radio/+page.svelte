<script lang="ts">
	import RadioStations from 'comun/components/RadioStations.svelte';
	import RadioTabs from 'comun/components/RadioTabs.svelte';
	import type { PageProps } from './$types';

	/** The stations (#253), as at home, played on this device; and the family's podcasts. */
	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Radio · Nube</title>
</svelte:head>

<div class="mb-4 flex flex-wrap items-center gap-3">
	<h1 class="mr-auto text-2xl font-bold">Radio</h1>
</div>
<RadioTabs />
<RadioStations info={data.info} />
