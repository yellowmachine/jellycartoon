<script lang="ts">
	import AgendaTabs from '#lib/components/AgendaTabs.svelte';
	import type { PageProps } from './$types';
	import Alarmas from './Alarmas.svelte';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Alarmas · Agenda · JellyCartoon</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<h1 class="mb-3 text-2xl font-bold">Agenda</h1>
	<AgendaTabs current="alarmas" />
	<Alarmas
		alarms={data.alarms}
		people={data.people}
		satellites={data.satellites}
		house={data.house}
		me={data.me}
		readonly={data.readonly}
	/>
</div>
