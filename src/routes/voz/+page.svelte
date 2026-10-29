<script lang="ts">
	import { onMount } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import VoicePanel from '#lib/components/VoicePanel.svelte';
	import { kitchenMode } from '#lib/kitchen-mode.svelte.ts';

	// «Modo cocina» from Seilide's home (/voz?cocina): turned on here, and the link left clean.
	onMount(() => {
		if (!page.url.searchParams.has('cocina')) return;
		kitchenMode.load();
		void kitchenMode.set(true);
		const url = new URL(page.url.href);
		url.searchParams.delete('cocina');
		replaceState(url, page.state);
	});
</script>

<svelte:head>
	<title>Hablar · JellyCartoon</title>
</svelte:head>

<VoicePanel />
