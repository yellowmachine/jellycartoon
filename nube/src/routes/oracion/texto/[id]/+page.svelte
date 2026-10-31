<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { music } from 'comun/music-player.svelte.ts';
	import TryVoice from '#lib/components/TryVoice.svelte';
	import {
		LONG_TEXT,
		MAX_TEXT,
		MAX_TITLE,
		prayerQueue,
		STATUS_COLOR,
		STATUS_LABEL,
		tryPiece
	} from '#lib/prayers.ts';
	import { field, primary, secondary, select } from '#lib/styles.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// The form starts as saved; after saving, as it is now. Only when what is saved changes: asking
	// how the voice goes (every few seconds) does not undo what is being written.
	let title = $state('');
	let text = $state('');
	let voiceId = $state('');
	const saved = $derived(
		JSON.stringify([
			data.prayer?.id,
			data.prayer?.title ?? '',
			data.prayer?.text ?? '',
			String(data.prayer?.voiceId ?? data.voices[0]?.id ?? '')
		])
	);
	$effect.pre(() => {
		[, title, text, voiceId] = JSON.parse(saved);
	});
	/** The voice chosen, as it is, to try the text's first lines with it. */
	const chosen = $derived(data.voices.find((v) => String(v.id) === voiceId));
	/** Long, and never heard in this voice: worth trying a little first. */
	const tryFirst = $derived(text.length > LONG_TEXT && !data.prayer?.audioUrl);
	const changed = $derived(
		!data.prayer ||
			title !== data.prayer.title ||
			text !== data.prayer.text ||
			voiceId !== String(data.prayer.voiceId)
	);
	let deleting = $state(false);

	$effect(() => {
		if (data.prayer?.status !== 'generando') return;
		const timer = setInterval(() => void invalidateAll(), 4000);
		return () => clearInterval(timer);
	});

	function listen() {
		const p = data.prayer;
		if (!p) return;
		const { tracks } = prayerQueue(
			{ id: 0, title: p.title, pauseSec: 0, items: [{ prayerId: p.id, times: 1 }] },
			[p]
		);
		if (tracks.length) music.play(tracks);
	}

	const keep =
		() =>
		async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) =>
			update({ reset: false });
</script>

<svelte:head>
	<title>{data.prayer?.title ?? 'Nuevo texto'} · Oración · JellyCartoon</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<a href="/oracion" class="mb-3 inline-block text-sm text-zinc-400 hover:underline">← Oración</a>
	<h1 class="mb-4 text-2xl font-bold">{data.prayer ? 'Texto' : 'Nuevo texto'}</h1>

	{#if !data.voices.length}
		<p class="mb-4 text-sm text-zinc-400">
			Antes, una voz: cuál de las de Gemini y cómo lee.
			<a href="/oracion/voces" class="text-amber-400 hover:underline">Crear una voz</a>
		</p>
	{:else}
		<form method="post" action="?/save" use:enhance={keep} class="flex flex-col gap-4">
			<label class="flex flex-col gap-1 text-xs text-zinc-400">
				Título
				<input name="title" bind:value={title} maxlength={MAX_TITLE} required class={field} />
			</label>
			<label class="flex flex-col gap-1 text-xs text-zinc-400">
				Voz
				<select name="voiceId" bind:value={voiceId} class="{select} self-start">
					{#each data.voices as v (v.id)}
						<option value={String(v.id)}>{v.name}</option>
					{/each}
				</select>
			</label>
			<label class="flex flex-col gap-1 text-xs text-zinc-400">
				Texto
				<textarea
					name="text"
					bind:value={text}
					maxlength={MAX_TEXT}
					required
					rows="14"
					class={field}
					placeholder="Pega aquí la oración o la letanía. Cada línea se lee entera; una línea en blanco, un respiro."
				></textarea>
			</label>
			{#if chosen && text.trim()}
				<div class={tryFirst ? 'rounded-md border border-amber-500/40 p-3' : ''}>
					{#if tryFirst}
						<p class="mb-2 text-sm text-amber-300">
							Es un texto largo: antes de generarlo entero, prueba cómo suenan sus primeras líneas
							con esta voz. Si no te gusta, cambia la voz o su «Cómo lee» en
							<a href="/oracion/voces" class="underline">Voces</a>.
						</p>
					{/if}
					<TryVoice
						voice={chosen.voice}
						tone={chosen.tone}
						text={tryPiece(text)}
						label="▶ Probar las primeras líneas"
					/>
				</div>
			{/if}
			<div class="flex flex-wrap items-center gap-2">
				<button name="generate" value="1" class={primary} disabled={!changed && !!data.prayer}
					>Guardar y generar la voz</button
				>
				<button class={secondary} disabled={!changed}>Guardar sin generar</button>
				{#if form && 'saved' in form && !changed}<span class="text-sm text-emerald-400"
						>Guardado</span
					>{/if}
				{#if data.prayer}
					<!-- How its voice goes, here too: «La voz» is below a long text. -->
					<span class="text-sm {STATUS_COLOR[data.prayer.status]}"
						>{STATUS_LABEL[data.prayer.status]}</span
					>
				{/if}
			</div>
		</form>
	{/if}

	{#if form && 'problem' in form}
		<p class="mt-3 text-sm text-red-400">{form.problem}</p>
	{/if}

	{#if data.prayer}
		{@const p = data.prayer}
		<section class="mt-8 rounded-md border border-zinc-800 p-4">
			<h2 class="mb-2 font-semibold">La voz</h2>
			<p class="mb-3 text-sm {p.status === 'error' ? 'text-red-400' : 'text-zinc-300'}">
				{STATUS_LABEL[p.status]}{#if p.error}: {p.error}{/if}
			</p>
			<div class="flex flex-wrap gap-2">
				<button class={secondary} disabled={!p.audioUrl} onclick={listen}>▶ Escuchar</button>
				{#if p.status !== 'generando' && !changed}
					<form method="post" action="?/generate" use:enhance>
						<button class={secondary}>{p.audioUrl ? 'Regenerar' : 'Generar'}</button>
					</form>
				{/if}
			</div>
			{#if changed}
				<p class="mt-2 text-xs text-zinc-500">Guarda los cambios para generar con ellos.</p>
			{/if}
		</section>

		<form method="post" action="?/delete" class="mt-8" use:enhance>
			{#if deleting}
				<span class="text-sm text-zinc-300">¿Borrarlo? También sale de las listas.</span>
				<button class="ml-2 text-sm text-red-400 hover:underline">Sí, borrar</button>
				<button type="button" class="ml-2 text-sm text-zinc-400" onclick={() => (deleting = false)}
					>No</button
				>
			{:else}
				<button
					type="button"
					class="text-sm text-red-400 hover:underline"
					onclick={() => (deleting = true)}>Borrar</button
				>
			{/if}
		</form>
	{/if}
</div>
