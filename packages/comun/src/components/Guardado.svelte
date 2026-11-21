<!--
@component
«✓ Guardado» y parecidos: un momento después de cada envío, y se va. Con cada envío vuelve a
salir (un `form` nuevo), así que al guardar otra vez se ve que se ha guardado.
-->
<script lang="ts" module>
	import type { Snippet } from 'svelte';

	export interface GuardadoProps {
		/** What is shown (e.g. «✓ Guardado»). */
		children: Snippet;
		/** Classes for the text. */
		class?: string;
	}
</script>

<script lang="ts">
	import { fade } from 'svelte/transition';
	import { page } from '$app/state';

	let { children, class: classes = '' }: GuardadoProps = $props();

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
