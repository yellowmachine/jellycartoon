<script lang="ts">
	import Guardado from 'comun/components/Guardado.svelte';
	import { enhance } from '$app/forms';
	import {
		DEFAULT_TONE,
		MAX_FILLER_CHARS,
		MAX_TONE_CHARS,
		per100Text,
		SATELLITE_VOICES,
		satelliteVoiceModel
	} from 'comun/ai-voice.ts';
	import { onDestroy } from 'svelte';
	import { primary, secondary, section, select } from '#lib/styles.ts';
	import type { PageData, ActionData } from './$types';

	/**
	 * Cómo hablan los satélites que sirve Seilide (#296): una voz (las rápidas o las de Gemini, #347), cómo dice las cosas
	 * (acento, ánimo) y las frases que dice mientras piensa la IA. «Probar» la oye aquí, antes de
	 * guardar. Y cómo van las frases (#301): grabándose, listas o con su problema.
	 */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	let formEl = $state<HTMLFormElement>();
	/** The one picked, saved or not: whether «Cómo habla» counts for it. */
	let picked = $derived(data.satelliteVoice?.voice ?? '');
	const pickedVoice = $derived(satelliteVoiceModel(picked));
	const takesTone = $derived(pickedVoice.tone);
	const fastVoices = SATELLITE_VOICES.filter((v) => v.fast);
	const geminiVoices = SATELLITE_VOICES.filter((v) => !v.fast);
	let trying = $state(false);
	let problem = $state<string | null>(null);

	/** As phrasesState (satellite-voice.ts) says. */
	type Phrase = {
		text: string;
		state: 'ready' | 'recording' | 'failed' | 'missing';
		problem: string | null;
	};
	let phrases = $state<Phrase[] | null>(null);
	let polling: ReturnType<typeof setTimeout> | undefined;
	const ready = $derived(phrases?.filter((p) => p.state === 'ready').length ?? 0);
	const recording = $derived(phrases?.some((p) => p.state === 'recording') ?? false);
	const failedOnes = $derived(phrases?.filter((p) => p.state === 'failed') ?? []);
	const missing = $derived(phrases?.some((p) => p.state === 'missing') ?? false);

	/** How they are; again in a moment while one is being recorded. */
	async function look(res?: Promise<Response>) {
		clearTimeout(polling);
		const answer = await (res ?? fetch('/api/ajustes/voz-satelite/frases')).catch(() => null);
		if (!answer?.ok) return;
		phrases = await answer.json();
		if (recording) polling = setTimeout(() => void look(), 2000);
	}

	function recordAgain() {
		void look(fetch('/api/ajustes/voz-satelite/frases', { method: 'POST' }));
	}

	$effect(() => {
		// Once on opening, and after each save.
		void form;
		if (data.satelliteVoice) void look();
	});
	onDestroy(() => clearTimeout(polling));

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
			Cómo contestan los satélites de voz de aquí arriba: una voz, con la clave de IA de la familia,
			y cómo dice las cosas. Las rápidas dicen la respuesta en menos de un segundo; las de Gemini
			tardan uno o dos, pero hacen caso a «Cómo habla».
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
				<select name="voice" class={select} bind:value={picked}>
					<optgroup label="Rápidas (contestan en menos de un segundo)">
						{#each fastVoices as v (v.id)}
							<option value={v.id}>{v.label} · {per100Text(v.per100)} cada 100</option>
						{/each}
					</optgroup>
					<optgroup label="Gemini (con «Cómo habla»; uno o dos segundos)">
						{#each geminiVoices as v (v.id)}
							<option value={v.id}>{v.label} · {per100Text(v.per100)} cada 100</option>
						{/each}
					</optgroup>
				</select>
			</label>
			<p class="-mt-1 text-xs text-zinc-500">
				Unos {per100Text(pickedVoice.per100)} cada 100 respuestas de las normales (las largas, como el
				tiempo, hasta tres veces más), de la clave de IA de la familia. Las frases de espera se graban
				una vez.
			</p>
			<label class="flex flex-col gap-1 text-zinc-300">
				Cómo habla (si quieres)
				<textarea
					name="tone"
					rows="3"
					maxlength={MAX_TONE_CHARS}
					value={data.satelliteVoice.tone === DEFAULT_TONE ? '' : data.satelliteVoice.tone}
					placeholder={DEFAULT_TONE}
					readonly={!takesTone}
					class="{select} w-full {takesTone ? '' : 'opacity-50'}"></textarea>
				<span class="text-xs text-zinc-500"
					>{takesTone
						? 'Vacío: como pone ahí, con acento de Buenos Aires.'
						: 'Esta voz no lo usa: habla con su propio acento. Solo las de Gemini.'}</span
				>
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
			{#if phrases?.length}
				<div class="-mt-1 flex flex-col gap-1">
					<span class="text-xs" aria-live="polite">
						{#if recording}
							<span class="text-zinc-400">Grabando las frases… {ready} de {phrases.length}</span>
						{:else if ready === phrases.length}
							<span class="text-emerald-400">✓ Frases listas</span>
						{:else if !failedOnes.length && missing}
							<span class="text-zinc-400">Faltan {phrases.length - ready} por grabar</span>
						{/if}
					</span>
					{#each failedOnes as p (p.text)}
						<span class="text-xs text-red-400">No se pudo grabar «{p.text}»: {p.problem}</span>
					{/each}
					{#if !recording && ready < phrases.length}
						<button type="button" class="{secondary} self-start" onclick={recordAgain}>
							{failedOnes.length ? 'Grabar otra vez' : 'Grabar'}
						</button>
					{/if}
				</div>
			{/if}
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
