<script lang="ts">
	import { onMount } from 'svelte';
	import { micMode, type MicMode } from '#lib/mic-mode.svelte.ts';
	import { WAKE_THRESHOLD, wakeWord } from '#lib/wake-word.svelte.ts';
	import { WAKE_WORDS, type WakeWordModel } from '#lib/wake-words.ts';
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
			{#each [['hold', 'Mantener pulsado'], ['tap', 'Tocar para empezar y para enviar'], ['auto', 'Tocar y se envía al callarte']] as const as [value, label] (value)}
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
			{#if mounted && micMode.auto}
				Un toque y hablas: suena un pitido, y se envía solo cuando llevas un segundo largo callado,
				como después de «hola casita». Si no dices nada en 5 segundos, se cancela; otro toque lo
				envía ya. La primera vez tarda un momento en preparar el micrófono.
			{:else if mounted && micMode.tap}
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
			Activar la voz diciendo una palabra
		</label>
		<p class="mt-2 text-sm text-zinc-400">
			Sin pulsar nada: suena un pitido, dices lo que quieres y se envía cuando te callas. Escucha
			mientras la app está abierta y delante, con la pantalla encendida; al abrir la app hay que
			tocar la pantalla una vez. Nada sale del dispositivo hasta que oye la palabra.
		</p>
		{#if mounted && wakeWord.on}
			<p class={['mt-2 text-sm', wakeWord.problem ? 'text-red-400' : 'text-zinc-300']}>
				{wakeWord.problem ??
					{
						off: 'Parada.',
						loading: 'Preparando (unos 9 MB la primera vez)…',
						on: `Escuchando «${WAKE_WORDS[wakeWord.word]}».`,
						tap: 'Toca la pantalla para que empiece a escuchar.'
					}[wakeWord.status]}
			</p>
			<label class="mt-4 flex flex-wrap items-center gap-2 text-sm">
				Palabra:
				<select
					value={wakeWord.word}
					onchange={(e) => wakeWord.setWord(e.currentTarget.value as WakeWordModel)}
					class="rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm"
				>
					{#each Object.entries(WAKE_WORDS) as [model, label] (model)}
						<option value={model}>«{label}»</option>
					{/each}
				</select>
			</label>
			<p class="mt-1 text-xs text-zinc-500">
				«Alexa» viene ya entrenada por openWakeWord, con muchas más voces: suele ir mejor, pero sale
				en la tele, y si tienes un Echo contestan los dos.
			</p>
			<label class="mt-4 block text-sm">
				Umbral: <span class="font-mono text-amber-400"
					>{wakeWord.threshold.toFixed(2).replace('.', ',')}</span
				>
				<input
					type="range"
					min={WAKE_THRESHOLD.min}
					max={WAKE_THRESHOLD.max}
					step={WAKE_THRESHOLD.step}
					value={wakeWord.threshold}
					oninput={(e) => wakeWord.setThreshold(Number(e.currentTarget.value))}
					class="mt-1 block w-full max-w-xs accent-amber-500"
				/>
			</label>
			<p class="mt-1 text-xs text-zinc-500">
				Más bajo, salta más fácil (con la tele puesta, por ejemplo), pero también sola más a menudo.
				Empieza en {WAKE_THRESHOLD.default.toFixed(1).replace('.', ',')}; en la prueba de abajo se
				ve con qué valor salta tu voz.
			</p>
			<label class="mt-4 flex items-start gap-2 text-sm">
				<input
					type="checkbox"
					checked={wakeWord.cleanWhenQuiet}
					onchange={(e) => wakeWord.setCleanWhenQuiet(e.currentTarget.checked)}
					class="mt-0.5 rounded border-zinc-600 bg-zinc-900 text-amber-500"
				/>
				<span>
					Limpiar el sonido cuando no suena nada en este aparato
					<span class="block text-xs text-zinc-500"
						>Quita eco y ruido y sube tu voz: puede ayudar desde lejos y en silencio. Con la tele
						puesta suele ir peor, y con música o un vídeo sonando aquí nunca se limpia.</span
					>
				</span>
			</label>
			<label class="mt-4 flex items-start gap-2 text-sm">
				<input
					type="checkbox"
					checked={wakeWord.advanced}
					onchange={(e) => wakeWord.setAdvanced(e.currentTarget.checked)}
					class="mt-0.5 rounded border-zinc-600 bg-zinc-900 text-amber-500"
				/>
				<span>
					Avanzado: ver cómo oye, bajo el micrófono grande
					<span class="block text-xs text-zinc-500"
						>En Hablar y en el panel de cocina: el nivel del micrófono (azul), cuánto se parece a la
						palabra (amarillo, con la raya del umbral), y el umbral y la limpieza para cambiarlos
						mientras pruebas. Ahí se puede limpiar también con algo sonando en la app.</span
					>
				</span>
			</label>
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
