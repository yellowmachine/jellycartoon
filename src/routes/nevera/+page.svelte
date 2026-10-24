<script lang="ts">
	import FridgeBoard from '#lib/components/FridgeBoard.svelte';
	import type { FridgeState } from '#lib/fridge.ts';
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
	<title>Nevera · JellyCartoon</title>
</svelte:head>

<div class="mx-auto max-w-4xl">
	<h1 class="mb-1 text-2xl font-bold">Nevera</h1>
	<p class="mb-6 text-sm text-zinc-400">
		Post-its para toda la casa, y la lista de la compra. Se ven en la tele del salón, y a los demás
		les llega un aviso al móvil si lo tienen activado en <a
			href="/ajustes?seccion=aspecto#este-dispositivo"
			class="text-amber-400 hover:underline">Ajustes</a
		>. También por voz: «añade leche a la lista».
	</p>
	<FridgeBoard {fridge} />
</div>
