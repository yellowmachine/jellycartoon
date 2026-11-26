<script lang="ts">
	import Chat from '#lib/components/Chat.svelte';
	import GuideLink from '#lib/components/GuideLink.svelte';
	import PreguntarTabs from '#lib/components/PreguntarTabs.svelte';
	import type { PageProps } from './$types';

	/** «Preguntar» (#470): the person's chat, the whole page; the side panel shows the same (#504). */
	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Preguntar · Seilide</title>
</svelte:head>

<div class="mx-auto max-w-2xl">
	<h1 class="mb-3 text-2xl font-bold">
		Preguntar<GuideLink page="preguntar" label="Preguntar" />
	</h1>
	<PreguntarTabs />
	<Chat messages={data.messages} toBuy={data.toBuy} hasAi={data.hasAi} />
</div>
