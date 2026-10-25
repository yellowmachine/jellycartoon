<script lang="ts">
	import { onMount } from 'svelte';
	import { micMode, type MicMode } from '#lib/mic-mode.svelte.ts';
	import { wakeWord } from '#lib/wake-word.svelte.ts';
	import { section } from './styles.ts';
	import type { PageData } from './$types';

	/** Voz y micrófono en este aparato, y «hola casita» (#144). */
	let { data }: { data: PageData } = $props();

	/** This device's name and what it is are only known in the browser. */
	let mounted = $state(false);
	onMount(() => (mounted = true));
</script>

{#if data.voice}
	<section class={section} id="microfono">
		<h2 class="mb-1 font-semibold">Voz y micrófono</h2>
		<p class="mb-4 text-sm text-zinc-400">
			Cómo se habla en este dispositivo, en Hablar, en el micrófono de arriba y con
			Ctrl+Mayús+Espacio. Solo aquí: la tablet de la cocina puede ir con toques y el móvil
			manteniendo pulsado.
		</p>
		<div class="flex flex-wrap gap-2">
			{#each [['hold', 'Mantener pulsado'], ['tap', 'Tocar para empezar y para enviar']] as const as [value, label] (value)}
				<button
					type="button"
					aria-pressed={mounted && micMode.value === value}
					onclick={() => micMode.set(value as MicMode)}
					class={[
						'rounded-full border px-3 py-1 text-sm',
						mounted && micMode.value === value
							? 'border-amber-500 text-amber-400'
							: 'border-zinc-700 hover:bg-zinc-900'
					]}>{label}</button
				>
			{/each}
		</div>
		<p class="mt-2 text-sm text-zinc-400">
			{#if mounted && micMode.tap}
				Un toque empieza a escuchar y otro lo envía; si se olvida, se envía solo a los 30 segundos.
				Dos toques seguidos lo cancelan. El micrófono de arriba, mantenido, abre Hablar.
			{:else}
				Hablas mientras lo mantienes pulsado y se envía al soltar, como un audio de WhatsApp.
			{/if}
		</p>
		<!-- #144, phase 2: the wake word, only on this device. -->
		<label
			id="hola-casita"
			class="mt-4 flex items-center gap-3 border-t border-zinc-800 pt-4 text-sm"
		>
			<input
				type="checkbox"
				checked={mounted && wakeWord.on}
				onchange={(e) => wakeWord.set(e.currentTarget.checked)}
				class="rounded border-zinc-600 bg-zinc-900 text-amber-500"
			/>
			Activar la voz diciendo «hola casita»
		</label>
		<p class="mt-2 text-sm text-zinc-400">
			Sin pulsar nada: suena un pitido, dices lo que quieres y se envía cuando te callas. Escucha
			mientras la app está abierta y delante, con la pantalla encendida; al abrir la app hay que
			tocar la pantalla una vez. Nada sale del dispositivo hasta que oye «hola casita».
		</p>
		{#if mounted && wakeWord.on}
			<p class={['mt-2 text-sm', wakeWord.problem ? 'text-red-400' : 'text-zinc-300']}>
				{wakeWord.problem ??
					{
						off: 'Parada.',
						loading: 'Preparando (unos 9 MB la primera vez)…',
						on: 'Escuchando «hola casita».',
						tap: 'Toca la pantalla para que empiece a escuchar.'
					}[wakeWord.status]}
			</p>
		{/if}
		<p class="mt-3 text-sm">
			<a href="/activacion" class="text-amber-400 hover:underline"
				>Probar la palabra de activación</a
			>
			<span class="text-zinc-400"
				>: solo prueba, mientras estás en esa página; para que escuche en toda la app, marca la
				casilla de arriba.</span
			>
		</p>
	</section>
{/if}
