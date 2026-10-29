<script lang="ts">
	import Landing from '#lib/components/Landing.svelte';
	import Home from '#lib/components/Home.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

{#if !data.user}
	<Landing {form} />
{:else if data.home}
	<Home
		name={data.user.name}
		home={data.home}
		weather={data.weather}
		trip={data.trip}
		watching={data.watching}
		receipts={data.receipts}
	/>
{:else}
	<h1 class="mb-2 text-2xl font-bold">Hola, {data.user.name}</h1>
	<p class="text-sm text-zinc-400">Tu cuenta aún no está en ninguna familia.</p>
{/if}
