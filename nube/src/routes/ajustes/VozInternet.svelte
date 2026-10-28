<script lang="ts">
	import Guardado from 'comun/components/Guardado.svelte';
	import { enhance } from '$app/forms';
	import { section, select, primary } from '#lib/styles.ts';
	import type { PageData, ActionData } from './$types';

	/**
	 * La voz buscando en internet (#243): solo si se activa, y solo cuando necesita algo de
	 * actualidad que no sabe. Dónde buscar, en texto libre; vacío, donde mejor encaje.
	 */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();
</script>

{#if data.voiceWeb}
	<section class={section} id="voz-internet">
		<h2 class="mb-1 font-semibold">Buscar en internet desde la voz</h2>
		<p class="mb-3 text-sm text-zinc-400">
			Para lo que la IA no sabe porque es de hoy: un resultado, una noticia, el horario de una
			tienda. Solo busca cuando hace falta; cada búsqueda cuesta algo más de un céntimo y tarda unos
			segundos.
		</p>
		<form
			method="post"
			action="?seccion={tab}&/saveVoiceWeb"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
			class="flex flex-col gap-3 text-sm"
		>
			<label class="flex items-center gap-2">
				<input type="checkbox" name="on" checked={data.voiceWeb.on} class="rounded" />
				Puede buscar en internet
			</label>
			<label class="flex flex-col gap-1 text-zinc-300">
				Indicaciones para buscar (si quieres)
				<textarea
					name="hints"
					rows="3"
					maxlength="500"
					value={data.voiceWeb.hints}
					placeholder="Para deportes, Marca o ESPN; nada de webs de apuestas; si pregunto por tiendas, cerca de casa…"
					class="{select} w-full"></textarea>
				<span class="text-xs text-zinc-500"
					>Vacío: busca donde mejor encaje. Siempre contesta corto, dice de qué día es lo que
					encuentra y no se inventa nada.</span
				>
			</label>
			<div class="flex items-center gap-3">
				<button class={primary}>Guardar</button>
				{#if form && 'saved' in form && form.saved === 'voiceWeb'}
					<Guardado class="text-amber-400">✓ Guardado</Guardado>
				{/if}
			</div>
		</form>
	</section>
{/if}
