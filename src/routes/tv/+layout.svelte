<script lang="ts">
	import { afterNavigate, invalidateAll } from '$app/navigation';

	let { children } = $props();
	let main = $state<HTMLElement>();

	// The remote needs something with the focus to start from: the first tile.
	afterNavigate(() => main?.querySelector<HTMLElement>('a, button')?.focus());
</script>

<!-- Back from mpv (the window gets the focus again): what was watched moved on. -->
<svelte:window onfocus={() => invalidateAll()} />

<main bind:this={main} class="min-h-screen px-12 py-10 text-2xl">
	{@render children()}
</main>
