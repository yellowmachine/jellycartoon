<script lang="ts">
	import GuideLink from '#lib/components/GuideLink.svelte';
	import FridgeBoard from 'comun/components/FridgeBoard.svelte';
	import type { FridgeState } from 'comun/fridge.ts';
	import type { PageProps } from './$types';
	import FotoCompra from './FotoCompra.svelte';

	let { data }: PageProps = $props();

	// What the others change, here at once (SSE): the whole fridge on every change.
	let fridge = $derived<FridgeState>(data.fridge);
	$effect(() => {
		const events = new EventSource('/api/nevera/events');
		events.onmessage = (e) => (fridge = JSON.parse(e.data));
		return () => events.close();
	});

	// The item whose photo is open: gone from the list, closed.
	let openId = $state<number | null>(null);
	const open = $derived(fridge.list.items.find((i) => i.id === openId));
</script>

<svelte:head>
	<title>Nevera · Seilide</title>
</svelte:head>

<h1 class="mb-1 text-2xl font-bold">Nevera<GuideLink page="nevera" label="la nevera" /></h1>
<p class="mb-6 text-sm text-zinc-400">
	Post-its para toda la familia, y la lista de la compra. Lo que apuntéis aquí lo ven los demás al
	momento.
</p>
<FridgeBoard {fridge}>
	{#snippet itemExtra(item)}
		<button
			type="button"
			class="flex h-9 w-9 shrink-0 items-center justify-center"
			aria-label={item.photo ? `Ver la foto de ${item.text}` : `Poner foto a ${item.text}`}
			title={item.photo?.note || undefined}
			onclick={() => (openId = item.id)}
		>
			{#if item.photo}
				<img
					src={item.photo.url}
					alt=""
					loading="lazy"
					class="h-8 w-8 rounded border border-stone-300 object-cover"
				/>
			{:else}
				<span class="opacity-40 grayscale">📷</span>
			{/if}
		</button>
	{/snippet}
</FridgeBoard>
{#if open}
	<FotoCompra item={open} onclose={() => (openId = null)} />
{/if}
