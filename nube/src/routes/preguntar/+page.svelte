<script lang="ts">
	import Chat from '#lib/components/Chat.svelte';
	import type { PageProps } from './$types';

	/** «Preguntar» (#470): the person's chat, the whole page; the side panel shows the same (#504). */
	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Preguntar · Seilide</title>
</svelte:head>

<div class="mx-auto max-w-2xl">
	<Chat messages={data.messages} toBuy={data.toBuy} hasAi={data.hasAi}>
		{#snippet heading()}
			<h1 class="text-2xl font-bold">Preguntar</h1>
		{/snippet}
	</Chat>
</div>
