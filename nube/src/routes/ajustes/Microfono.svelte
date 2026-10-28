<script lang="ts">
	import { onMount } from 'svelte';
	import { micMode, type MicMode } from '#lib/mic-mode.svelte.ts';
	import { section } from '#lib/styles.ts';

	/** Cómo se habla en este aparato (#253), como en jellycartoon: mantener pulsado, o tocar. */

	/** This device's choice is only known in the browser. */
	let mounted = $state(false);
	onMount(() => (mounted = true));

	const MODES: [MicMode, string][] = [
		['hold', 'Mantener pulsado'],
		['tap', 'Tocar para empezar y para enviar']
	];
</script>

<section class={section} id="microfono">
	<h2 class="mb-1 font-semibold">Voz y micrófono</h2>
	<p class="mb-4 text-sm text-zinc-400">
		Cómo se habla en este dispositivo: en Hablar, en el micrófono de arriba, en el modo carretera y
		con Ctrl+Mayús+Espacio. Solo aquí: el móvil puede ir manteniendo pulsado y la tablet del coche
		con toques.
	</p>
	<div class="flex flex-wrap gap-2">
		{#each MODES as [value, label] (value)}
			<button
				type="button"
				aria-pressed={mounted && micMode.value === value}
				onclick={() => micMode.set(value)}
				class={[
					'rounded-full border px-3 py-1 text-sm',
					mounted && micMode.value === value
						? 'border-amber-500 text-amber-400'
						: 'border-zinc-700 hover:bg-zinc-900'
				]}>{label}</button
			>
		{/each}
	</div>
</section>
