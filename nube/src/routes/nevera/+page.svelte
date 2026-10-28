<script lang="ts">
	import FridgeBoard from 'comun/components/FridgeBoard.svelte';
	import type { FridgeState } from 'comun/fridge.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// What the others change, here at once (SSE): the whole fridge on every change.
	let fridge = $derived<FridgeState>(data.fridge);
	$effect(() => {
		const events = new EventSource('/api/nevera/events');
		events.onmessage = (e) => (fridge = JSON.parse(e.data));
		return () => events.close();
	});
</script>

<svelte:head>
	<title>Nevera · Nube</title>
</svelte:head>

<h1 class="mb-1 text-2xl font-bold">Nevera</h1>
<p class="mb-6 text-sm text-zinc-400">
	Post-its para toda la familia, y la lista de la compra. Lo que apuntéis aquí lo ven los demás al
	momento.
</p>
<FridgeBoard {fridge} />
