<script lang="ts">
	import { untrack } from 'svelte';
	import CallPanel from '#lib/components/CallPanel.svelte';
	import { phone } from '#lib/phone.svelte.ts';
	import type { PageProps } from './$types';

	/**
	 * A call's page (#330): where its notice takes the one called. «Contestar» on the notice answers
	 * on arriving; the page's own buttons, otherwise.
	 */
	let { data }: PageProps = $props();

	$effect(() => {
		const { info, answer } = data;
		untrack(() => {
			phone.open(info.id, info);
			if (answer) void phone.answer();
		});
	});
</script>

<svelte:head>
	<title>Llamada · Seilide</title>
</svelte:head>

<div class="mx-auto flex max-w-md flex-col gap-4">
	<CallPanel />
	{#if !phone.busy}
		<a href="/llamadas" class="text-center text-lg text-amber-400 hover:underline">Llamadas</a>
	{/if}
</div>
