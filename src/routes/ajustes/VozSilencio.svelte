<script lang="ts">
	import Guardado from './Guardado.svelte';
	import { enhance } from '$app/forms';
	import { section, select, primary, secondary } from './styles.ts';
	import type { PageData, ActionData } from './$types';

	/**
	 * Horas de silencio: de noche, lo que la voz fuera a poner (música, radio, un capítulo) lo
	 * pregunta antes, y solo lo pone con un «sí». Lo de la pantalla, las alarmas y parar, nunca.
	 */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();
</script>

{#if data.voiceQuiet}
	<section class={section} id="voz-silencio">
		<h2 class="mb-1 font-semibold">Horas de silencio</h2>
		<p class="mb-3 text-sm text-zinc-400">
			Por si la voz entiende mal de noche: en estas horas, antes de poner música, la radio o un
			capítulo, pregunta («Son las cuatro de la madrugada, ¿pongo Queen de verdad?») y solo lo pone
			si le dices que sí. Las alarmas, los temporizadores, parar y lo que pongas desde la pantalla
			van igual; en el coche no pregunta.
		</p>
		<form
			method="post"
			action="?seccion={tab}&/saveVoiceQuiet"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
			class="flex flex-col gap-3 text-sm"
		>
			<div class="flex flex-wrap items-center gap-2 text-zinc-300">
				De
				<input
					type="time"
					name="from"
					required
					value={data.voiceQuiet.hours?.from ?? '00:00'}
					class={select}
				/>
				a
				<input
					type="time"
					name="to"
					required
					value={data.voiceQuiet.hours?.to ?? '07:00'}
					class={select}
				/>
			</div>
			<div class="flex flex-wrap items-center gap-3">
				<button class={primary}>{data.voiceQuiet.hours ? 'Guardar' : 'Activar'}</button>
				{#if data.voiceQuiet.hours}
					<button class={secondary} name="off" value="1" formnovalidate>Quitar</button>
				{/if}
				{#if form && 'saved' in form && form.saved === 'voiceQuiet'}
					<Guardado class="text-amber-400">✓ Guardado</Guardado>
				{/if}
			</div>
			{#if !data.voiceQuiet.hours}
				<span class="text-xs text-zinc-500"
					>Ahora no hay: la voz pone lo que le pidan a cualquier hora.</span
				>
			{/if}
		</form>
	</section>
{/if}
