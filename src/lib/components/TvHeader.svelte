<script lang="ts">
	import { onMount } from 'svelte';
	import TvNowPlaying from './TvNowPlaying.svelte';

	/**
	 * The top of each TV page: where you are, what is playing, and the time, big enough for the sofa.
	 * `plain`: only the time, for a page whose content says where you are (Sonando).
	 */
	let { title, plain = false }: { title?: string; plain?: boolean } = $props();

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
		{#if plain}
			<!-- Nothing: the time stays on the right. -->
		{:else if title}
			<h1 class="truncate text-5xl font-bold">{title}</h1>
			<p class="mt-2 text-xl text-zinc-500">Atrás para volver</p>
		{:else}
			<p class="text-xl text-zinc-400 first-letter:uppercase">{date}</p>
			<h1 class="text-5xl font-bold">
				<span class="text-amber-400">Jelly</span>Cartoon
			</h1>
		{/if}
	</div>
	<div class="flex min-w-0 items-center gap-6">
		<TvNowPlaying />
		<p class="shrink-0 text-6xl font-light text-zinc-200 tabular-nums">{time}</p>
	</div>
</header>
