<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { AI_VOICES, MAX_TONE_CHARS } from 'comun/ai-voice.ts';
	import TryVoice from '#lib/components/TryVoice.svelte';
	import { MAX_TRY, MAX_VOICE_NAME, TRY_SAMPLE } from '#lib/prayers.ts';
	import { field, primary, secondary, select } from '#lib/styles.ts';

	/**
	 * A voice of Oración (#339), new (`id` 0) or changed, with a few lines to try it as it is being
	 * written, before saving it and before recording long texts with it.
	 */
	let {
		v,
		problem,
		done
	}: {
		v: { id: number; name: string; voice: string; tone: string };
		problem?: string | null;
		done: () => void;
	} = $props();

	// As it was opened: what is written from then on is the editor's.
	let name = $state(untrack(() => v.name));
	let voice = $state(untrack(() => v.voice));
	let tone = $state(untrack(() => v.tone));
	let sample = $state(TRY_SAMPLE);
</script>

<form
	method="post"
	action="?/save"
	use:enhance={() =>
		async ({ result, update }) => {
			await update({ reset: false });
			if (result.type === 'success') done();
		}}
	class="flex flex-col gap-3 rounded-md border border-zinc-700 bg-zinc-900 p-4"
>
	{#if v.id}<input type="hidden" name="id" value={v.id} />{/if}
	<div class="flex flex-wrap gap-3">
		<label class="flex min-w-0 flex-1 flex-col gap-1 text-xs text-zinc-400">
			Nombre
			<input
				name="name"
				bind:value={name}
				maxlength={MAX_VOICE_NAME}
				required
				class={field}
				placeholder="Rosario, Latín…"
			/>
		</label>
		<label class="flex flex-col gap-1 text-xs text-zinc-400">
			Voz de Gemini
			<select name="voice" bind:value={voice} class={select}>
				{#each AI_VOICES as g (g.id)}
					<option value={g.id}>{g.label}</option>
				{/each}
			</select>
		</label>
	</div>
	<label class="flex flex-col gap-1 text-xs text-zinc-400">
		Cómo lee
		<textarea
			name="tone"
			bind:value={tone}
			maxlength={MAX_TONE_CHARS}
			rows="3"
			class={field}
			placeholder="Pausado y solemne, voz grave. Para latín: latín eclesiástico, pronunciación romana (italiana)."
		></textarea>
	</label>
	<div class="rounded-md border border-zinc-800 p-3">
		<label class="flex flex-col gap-1 text-xs text-zinc-400">
			Prueba
			<textarea bind:value={sample} maxlength={MAX_TRY} rows="2" class={field}></textarea>
		</label>
		<p class="mt-1 mb-2 text-xs text-zinc-500">
			Antes de dar voz a una letanía entera, prueba aquí unas líneas: se oye en unos segundos,
			cuesta poco y no se guarda. Cambia la voz o «Cómo lee» hasta que te guste.
		</p>
		<TryVoice {voice} {tone} text={sample} />
	</div>
	<div class="flex gap-2">
		<button class={primary}>Guardar</button>
		<button type="button" class={secondary} onclick={done}>Cancelar</button>
	</div>
	{#if problem}<p class="text-sm text-red-400">{problem}</p>{/if}
</form>
