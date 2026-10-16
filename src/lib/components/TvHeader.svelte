<script lang="ts">
	import { onMount } from 'svelte';

	/** The top of each TV page: where you are, and the time, big enough for the sofa. */
	let { title }: { title?: string } = $props();

	let now = $state(new Date());
	onMount(() => {
		const timer = setInterval(() => (now = new Date()), 10_000);
		return () => clearInterval(timer);
	});
	const time = $derived(now.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }));
	const date = $derived(
		now.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })
	);
</script>

<header class="mb-10 flex items-end justify-between gap-8">
	<div class="min-w-0">
		{#if title}
			<h1 class="truncate text-5xl font-bold">{title}</h1>
			<p class="mt-2 text-xl text-zinc-500">Atrás para volver</p>
		{:else}
			<p class="text-xl text-zinc-400 first-letter:uppercase">{date}</p>
			<h1 class="text-5xl font-bold">
				<span class="text-amber-400">Jelly</span>Cartoon
			</h1>
		{/if}
	</div>
	<p class="shrink-0 text-6xl font-light text-zinc-200 tabular-nums">{time}</p>
</header>
