<script lang="ts">
	import Guardado from 'comun/components/Guardado.svelte';
	import { enhance } from '$app/forms';
	import { AI_VOICES, DEFAULT_TONE, MAX_FILLER_CHARS, MAX_TONE_CHARS } from 'comun/ai-voice.ts';
	import { primary, secondary, section, select } from '#lib/styles.ts';
	import type { PageData, ActionData } from './$types';

	/**
	 * Cómo hablan los satélites que sirve Seilide (#296): una voz de Gemini, cómo dice las cosas
	 * (acento, ánimo) y las frases que dice mientras piensa la IA. «Probar» la oye aquí, antes de
	 * guardar.
	 */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	let formEl = $state<HTMLFormElement>();
	let trying = $state(false);
	let problem = $state<string | null>(null);

	async function tryIt() {
		trying = true;
		problem = null;
		// As it is written now, not yet saved.
		const values = new FormData(formEl);
		const res = await fetch('/api/ajustes/voz-satelite', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				voice: values.get('voice'),
				tone: values.get('tone'),
				text: 'Hola, soy la voz de los satélites. ¿Pongo un temporizador de media hora?'
			})
		}).catch(() => null);
		trying = false;
		if (!res?.ok) {
			problem = (await res?.json().catch(() => null))?.message ?? 'Sin conexión';
			return;
		}
		const url = URL.createObjectURL(await res.blob());
		const audio = new Audio(url);
		audio.onended = () => URL.revokeObjectURL(url);
		void audio.play();
	}
</script>

{#if data.satelliteVoice}
	<section class={section} id="voz-satelites">
		<h2 class="mb-1 font-semibold">Voz de los satélites</h2>
		<p class="mb-3 text-sm text-zinc-400">
			Cómo contestan los satélites de voz de aquí arriba: una voz de Gemini, con la clave de IA de
			la familia, y cómo dice las cosas. Cada frase nueva tarda dos o tres segundos en decirse.
		</p>
		<form
			method="post"
			action="?seccion={tab}&/saveSatelliteVoice"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
			class="flex flex-col gap-3 text-sm"
			bind:this={formEl}
		>
			<label class="flex flex-wrap items-center gap-2 text-zinc-300">
				Voz
				<select name="voice" class={select}>
					{#each AI_VOICES as v (v.id)}
						<option value={v.id} selected={v.id === data.satelliteVoice.voice}>{v.label}</option>
					{/each}
				</select>
			</label>
			<label class="flex flex-col gap-1 text-zinc-300">
				Cómo habla (si quieres)
				<textarea
					name="tone"
					rows="3"
					maxlength={MAX_TONE_CHARS}
					value={data.satelliteVoice.tone === DEFAULT_TONE ? '' : data.satelliteVoice.tone}
					placeholder={DEFAULT_TONE}
					class="{select} w-full"></textarea>
				<span class="text-xs text-zinc-500">Vacío: como pone ahí, con acento de Buenos Aires.</span>
			</label>
			<label class="flex flex-col gap-1 text-zinc-300">
				Mientras piensa, una de estas (una por línea)
				<textarea
					name="fillers"
					rows="5"
					value={data.satelliteVoice.fillers.join('\n')}
					class="{select} w-full"></textarea>
				<span class="text-xs text-zinc-500"
					>Cortas, de hasta {MAX_FILLER_CHARS} letras: se dicen si la IA tarda. Vacío, las de siempre.
					Se graban al guardar; una que aún no está grabada no se dice.</span
				>
			</label>
			<div class="flex flex-wrap items-center gap-3">
				<button class={primary}>Guardar</button>
				<button type="button" class={secondary} onclick={tryIt} disabled={trying}>
					{trying ? 'Diciéndolo…' : '▶ Probar'}
				</button>
				{#if form && 'saved' in form && form.saved === 'satelliteVoice'}
					<Guardado class="text-amber-400">✓ Guardado</Guardado>
				{/if}
			</div>
			{#if problem}
				<p class="text-sm text-red-400">{problem}</p>
			{/if}
			{#if form && 'satelliteVoiceProblem' in form}
				<p class="text-sm text-red-400">{form.satelliteVoiceProblem}</p>
			{/if}
		</form>
	</section>
{/if}
