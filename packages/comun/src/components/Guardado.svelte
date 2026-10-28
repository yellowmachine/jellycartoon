<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade } from 'svelte/transition';
	import { page } from '$app/state';

	/**
	 * «✓ Guardado» y parecidos: un momento después de cada envío, y se va. Con cada envío vuelve a
	 * salir (un `form` nuevo), así que al guardar otra vez se ve que se ha guardado.
	 */
	let { children, class: classes = '' }: { children: Snippet; class?: string } = $props();

	const SHOWN_MS = 2500;
	let visible = $state(false);

	$effect(() => {
		void page.form;
		visible = true;
		const timer = setTimeout(() => (visible = false), SHOWN_MS);
		return () => clearTimeout(timer);
	});
</script>

{#key page.form}
	{#if visible}
		<span class={classes} in:fade={{ duration: 150 }} out:fade={{ duration: 300 }}
			>{@render children()}</span
		>
	{/if}
{/key}
