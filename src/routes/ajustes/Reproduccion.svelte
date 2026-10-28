<script lang="ts">
	import Guardado from './Guardado.svelte';
	import SubtitleStylePanel from '#lib/components/SubtitleStylePanel.svelte';
	import { enhance } from '$app/forms';
	import { languageLabel } from '#lib/languages.ts';
	import { ANSWER_SECONDS, ASK_EVERY_OPTIONS } from '#lib/still-there.ts';
	import type { SubtitleStyle } from '#lib/subtitle-style.ts';
	import { section, select, primary } from './styles.ts';
	import type { PageData, ActionData } from './$types';

	/** Reproducción: audio, subtítulos, cortinilla y «¿Sigues ahí?». */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	/** «¿Sigues ahí?» (#77), as a child's in /infantil. */
	const ASK: { value: number | null; label: string }[] = [
		{ value: null, label: 'Nunca' },
		...ASK_EVERY_OPTIONS.map((n) => ({ value: n, label: `Cada ${n} capítulos` }))
	];

	// Changed here at once; several quick clicks become one save, as in the player.
	let subtitleStyle = $derived(data.subtitleStyle);
	let styleTimer: ReturnType<typeof setTimeout> | undefined;
	let styleProblem = $state(false);
	function chooseSubtitleStyle(style: SubtitleStyle) {
		subtitleStyle = style;
		clearTimeout(styleTimer);
		styleTimer = setTimeout(async () => {
			const res = await fetch('/api/settings', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ subtitleStyle: style })
			}).catch(() => null);
			styleProblem = !res?.ok;
		}, 400);
	}
</script>

<section class={section} id="reproduccion">
	<h2 class="mb-1 font-semibold">Reproducción</h2>
	<p class="mb-4 text-sm text-zinc-400">
		Idiomas que se eligen al empezar un capítulo o una película, y cómo se ven los subtítulos: en el
		navegador y en el salón.
	</p>
	<form
		method="post"
		action="?seccion={tab}&/playback"
		use:enhance={() =>
			async ({ update }) =>
				update({ reset: false })}
		class="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-center"
	>
		<label for="audioLang" class="text-sm text-zinc-300">Audio</label>
		<select id="audioLang" name="audioLang" value={data.playback.audioLang ?? ''} class={select}>
			<option value="">El del vídeo</option>
			{#each data.languages as code (code)}
				<option value={code}>{languageLabel(code)}</option>
			{/each}
		</select>
		<label for="subtitleLang" class="text-sm text-zinc-300">Subtítulos</label>
		<select
			id="subtitleLang"
			name="subtitleLang"
			value={data.playback.subtitleLang ?? ''}
			class={select}
		>
			<option value="">Sin subtítulos</option>
			{#each data.languages as code (code)}
				<option value={code}>{languageLabel(code)}</option>
			{/each}
		</select>
		<div class="flex items-center gap-3 sm:col-start-2">
			<button class={primary}>Guardar</button>
			{#if form && 'saved' in form && form.saved === 'playback'}
				<Guardado class="text-sm text-amber-400">✓ Guardado</Guardado>
			{/if}
		</div>
	</form>
	<h3 id="estilo-subtitulos" class="mt-6 text-sm text-zinc-300">Subtítulos</h3>
	<p class="text-xs text-zinc-500">
		Para los de texto: los de imagen (DVD, Blu-ray) se ven siempre como vienen, y los de estilo
		propio (ASS) conservan el suyo en el salón.
	</p>
	<SubtitleStylePanel style={subtitleStyle} onchange={chooseSubtitleStyle} />
	{#if styleProblem}
		<p class="mt-2 text-sm text-red-400">No se pudo guardar el estilo.</p>
	{/if}
	{#if data.intro !== null}
		<form
			id="cortinilla"
			method="post"
			action="?seccion={tab}&/intro"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
			class="mt-4"
		>
			<label class="flex items-start gap-2 text-sm">
				<input
					type="checkbox"
					name="intro"
					checked={data.intro}
					onchange={(e) => e.currentTarget.form?.requestSubmit()}
					class="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-amber-500"
				/>
				<span>
					Cortinilla de Cine Club
					<span class="block text-xs text-zinc-500"
						>Antes de las películas que empiezan desde el principio en el salón. Se puede saltar
						desde el mando.</span
					>
				</span>
			</label>
		</form>
	{/if}
	{#if data.stillThere}
		<!-- #77: with «siguiente automático», for who falls asleep with the series. -->
		<form
			id="sigues-ahi"
			method="post"
			action="?seccion={tab}&/askEvery"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
			class="mt-4 text-sm"
		>
			<div class="flex flex-wrap items-center gap-2">
				<span class="mr-1">Preguntar «¿Sigues ahí?»</span>
				{#each ASK as option (option.value)}
					<button
						name="askEvery"
						value={option.value ?? ''}
						aria-pressed={data.stillThere.every === option.value}
						class={[
							'rounded-full border px-3 py-1',
							data.stillThere.every === option.value
								? 'border-amber-500 text-amber-400'
								: 'border-zinc-700 hover:bg-zinc-900'
						]}>{option.label}</button
					>
				{/each}
			</div>
			<p class="mt-1 text-xs text-zinc-500">
				Con «siguiente automático», tras esos capítulos seguidos sin tocar nada el siguiente espera
				a que contestes; si en {ANSWER_SECONDS / 60} minutos nadie lo hace, se para. Para cuando te duermes
				con la serie. En el navegador y en el salón.
			</p>
		</form>
	{/if}
</section>
