<script lang="ts">
	import { enhance } from '$app/forms';
	import { AI_VOICES } from 'comun/ai-voice.ts';
	import { primary } from '#lib/styles.ts';
	import VoiceEditor from './VoiceEditor.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const voiceLabel = (id: string) => AI_VOICES.find((v) => v.id === id)?.label ?? id;
	/** The one being changed (its id), or the new one (0); null, none. */
	let editing = $state<number | null>(null);
	const problemFor = (id: number) =>
		form && 'problem' in form && String(form.id ?? '') === (id ? String(id) : '')
			? form.problem
			: null;
</script>

<svelte:head>
	<title>Voces · Oración · JellyCartoon</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<a href="/oracion" class="mb-3 inline-block text-sm text-zinc-400 hover:underline">← Oración</a>
	<h1 class="mb-2 text-2xl font-bold">Voces</h1>
	<p class="mb-4 text-sm text-zinc-400">
		Cada texto se lee con una de estas: una voz de Gemini y cómo lee, con un nombre para elegirla.
		Cambiar una voz no cambia lo ya generado: sus textos quedan «Ha cambiado» para regenerarlos. Al
		crearla o cambiarla, pruébala con unas líneas antes de generar textos largos.
	</p>

	<ul class="mb-4 flex flex-col gap-2">
		{#each data.voices as v (v.id)}
			<li>
				{#if editing === v.id}
					<VoiceEditor {v} problem={problemFor(v.id)} done={() => (editing = null)} />
				{:else}
					<div class="flex items-start gap-3 rounded-md border border-zinc-800 p-3">
						<span class="min-w-0 flex-1">
							<span class="block"
								>{v.name} <span class="text-sm text-zinc-500">· {voiceLabel(v.voice)}</span></span
							>
							{#if v.tone}<span class="block text-xs text-zinc-400">{v.tone}</span>{/if}
							<span class="block text-xs text-zinc-500"
								>{v.uses ? `${v.uses} ${v.uses === 1 ? 'texto' : 'textos'}` : 'Sin textos'}</span
							>
							{#if problemFor(v.id)}<span class="block text-xs text-red-400"
									>{problemFor(v.id)}</span
								>{/if}
						</span>
						<button class="text-sm text-zinc-400 hover:underline" onclick={() => (editing = v.id)}
							>Cambiar</button
						>
						{#if !v.uses}
							<form method="post" action="?/delete" use:enhance>
								<input type="hidden" name="id" value={v.id} />
								<button class="text-sm text-red-400 hover:underline">Borrar</button>
							</form>
						{/if}
					</div>
				{/if}
			</li>
		{:else}
			<li class="text-sm text-zinc-600">Ninguna todavía.</li>
		{/each}
	</ul>

	{#if editing === 0}
		<VoiceEditor
			v={{ id: 0, name: '', voice: AI_VOICES[0].id, tone: '' }}
			problem={problemFor(0)}
			done={() => (editing = null)}
		/>
	{:else}
		<button class={primary} onclick={() => (editing = 0)}>+ Voz</button>
	{/if}
</div>
