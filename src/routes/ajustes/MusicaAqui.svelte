<script lang="ts">
	import MusicBackgroundSettings from 'comun/components/MusicBackgroundSettings.svelte';
	import { onMount } from 'svelte';
	import { musicQuality, type MusicQuality } from 'comun/music-quality.svelte.ts';
	import { section } from './styles.ts';
	import type { PageData } from './$types';

	/** Música en este aparato: calidad y fondo. */
	let { data }: { data: PageData } = $props();

	/** This device's name and what it is are only known in the browser. */
	let mounted = $state(false);
	onMount(() => (mounted = true));
</script>

{#if data.music}
	<section class={section} id="calidad-musica">
		<h2 class="mb-1 font-semibold">Calidad de la música</h2>
		<p class="mb-4 text-sm text-zinc-400">
			Solo en este dispositivo: el móvil puede ahorrar datos y la tele sonar como el CD. Se nota
			desde la siguiente canción.
		</p>
		<div class="flex flex-wrap gap-2">
			{#each [['original', 'Original'], ['saver', 'Ahorro (Opus)']] as const as [value, label] (value)}
				<button
					type="button"
					aria-pressed={mounted && musicQuality.value === value}
					onclick={() => musicQuality.set(value as MusicQuality)}
					class={[
						'rounded-full border px-3 py-1 text-sm',
						mounted && musicQuality.value === value
							? 'border-amber-500 text-amber-400'
							: 'border-zinc-700 hover:bg-zinc-900'
					]}>{label}</button
				>
			{/each}
		</div>
		<p class="mt-2 text-sm text-zinc-400">
			{#if mounted && musicQuality.value === 'saver'}
				Los CD en Opus: unas cinco veces menos datos y, al oído, igual; para escuchar con datos
				móviles. Los que aún no están comprimidos suenan en FLAC.
			{:else}
				Tal cual está en el disco: los CD en FLAC, sin pérdida (unos 25 MB por canción). Para casa.
				Lo que ya es Opus suena igual en los dos.
			{/if}
		</p>
	</section>

	<section class={section} id="fondo-musica">
		<h2 class="mb-1 font-semibold">Fondo de Música</h2>
		<p class="mb-4 text-sm text-zinc-400">
			Formas con los colores de la portada de lo que suena, detrás de las páginas de Música. Se
			mueven mientras suena. Solo en este dispositivo: la tele puede tener uno y el móvil ninguno.
		</p>
		<MusicBackgroundSettings />
	</section>
{/if}
