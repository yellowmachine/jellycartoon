<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { clock, TRUE_FALSE, type Exercise } from 'comun/homework.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const hw = $derived(data.homework);
	const draft = $derived(hw.status === 'draft');
	/** The draft as the adult edits it; again from the server after «Volver a proponer». */
	let exercises = $derived<Exercise[]>(structuredClone($state.snapshot(hw.exercises)));
	let title = $derived(hw.title);
	let busy = $state<string | null>(null);
	let confirmDelete = $state(false);

	const KIND = { choice: 'Elegir', truefalse: 'Verdadero o falso', open: 'Respuesta suya' };
	const languageOptions = $derived(TRUE_FALSE[hw.language === 'en' ? 'en' : 'es']);

	function remove(i: number) {
		exercises = exercises.filter((_, j) => j !== i);
	}
	function addOption(e: Exercise) {
		if (e.options.length < 6) e.options.push('');
	}
	function removeOption(e: Exercise, j: number) {
		e.options.splice(j, 1);
		if (e.answer !== null && e.answer >= j)
			e.answer = Math.max(0, e.answer - (e.answer > j ? 1 : 0));
	}

	/** The button that sent the form says what it is doing; the page's data comes back after. */
	const submit: SubmitFunction = ({ action }) => {
		busy = action.search.replace('?/', '');
		return async ({ update }) => {
			await update({ reset: false });
			busy = null;
		};
	};

	const input = 'w-full rounded-md border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm';
	const primary =
		'rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50';
	const secondary =
		'rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-900 disabled:opacity-50';
</script>

<svelte:head>
	<title>{hw.title} · Deberes · Seilide</title>
</svelte:head>

<p class="mb-2 text-sm">
	<a href="/deberes" class="text-zinc-400 hover:underline">← Deberes</a>
</p>
<h1 class="mb-1 text-2xl font-bold">{hw.title}</h1>
<p class="mb-6 text-zinc-400">
	Para {data.kid} · {hw.band} · {hw.language === 'en' ? 'en inglés' : 'en español'} ·
	{#if hw.status === 'draft'}
		<span class="text-amber-300">por revisar: {data.kid} no lo ve hasta que se lo des</span>
	{:else if hw.status === 'assigned'}
		<span class="text-sky-300">dado, sin terminar</span>
	{:else}
		<span class="text-emerald-300">
			hecho: {hw.marks.right} de {hw.marks.closed} bien{hw.marks.toRead
				? `, ${hw.marks.toRead} para leer`
				: ''}
		</span>
	{/if}
</p>

{#if form?.message}
	<p class="mb-4 text-sm text-red-400" role="alert">{form.message}</p>
{/if}

{#if draft}
	<form method="post" class="flex flex-col gap-6" use:enhance={submit}>
		<input type="hidden" name="exercises" value={JSON.stringify(exercises)} />
		<label class="flex flex-col gap-1 text-sm">
			<span class="text-zinc-300">Título, como lo ve {data.kid}</span>
			<input name="title" bind:value={title} maxlength="120" class={input} />
		</label>

		<ol class="flex flex-col gap-4">
			{#each exercises as e, i (i)}
				<li class="rounded-md border border-zinc-800 p-4">
					<div class="mb-2 flex flex-wrap items-baseline gap-2 text-xs text-zinc-400">
						<span class="font-semibold text-zinc-200">{i + 1}.</span>
						<span>{KIND[e.kind]}</span>
						<span
							>· {data.episodes[e.episodeId] ?? ''}{e.at !== null ? `, ${clock(e.at)}` : ''}</span
						>
						<button
							type="button"
							class="ml-auto text-zinc-500 hover:text-red-400"
							onclick={() => remove(i)}>Quitar</button
						>
					</div>
					<textarea
						bind:value={e.question}
						rows="2"
						maxlength="300"
						aria-label="Pregunta {i + 1}"
						class="{input} mb-2 resize-y"></textarea>

					{#if e.kind === 'open'}
						<label class="flex flex-col gap-1 text-xs text-zinc-400">
							Lo que debería decir (solo lo ves tú)
							<textarea bind:value={e.expected} rows="2" maxlength="300" class="{input} resize-y"
							></textarea>
						</label>
					{:else}
						<fieldset class="flex flex-col gap-1.5">
							<legend class="mb-1 text-xs text-zinc-400">Opciones: marca la buena</legend>
							{#each e.kind === 'truefalse' ? languageOptions : e.options as option, j (j)}
								<div class="flex items-center gap-2">
									<input
										type="radio"
										name="right-{i}"
										checked={e.answer === j}
										onchange={() => (e.answer = j)}
										aria-label="La buena es {option}"
										class="border-zinc-700 bg-zinc-900 text-emerald-500"
									/>
									{#if e.kind === 'truefalse'}
										<span class="text-sm">{option}</span>
									{:else}
										<input
											bind:value={e.options[j]}
											maxlength="120"
											aria-label="Opción {j + 1}"
											class={[input, e.answer === j && 'border-emerald-700']}
										/>
										{#if e.options.length > 2}
											<button
												type="button"
												class="text-zinc-500 hover:text-red-400"
												aria-label="Quitar opción"
												onclick={() => removeOption(e, j)}>✕</button
											>
										{/if}
									{/if}
								</div>
							{/each}
							{#if e.kind === 'choice' && e.options.length < 6}
								<button
									type="button"
									class="self-start text-xs text-zinc-400 hover:underline"
									onclick={() => addOption(e)}>+ Otra opción</button
								>
							{/if}
						</fieldset>
					{/if}
					{#if e.kind !== 'open'}
						<label class="mt-2 flex flex-col gap-1 text-xs text-zinc-400">
							Pista al equivocarse
							<input bind:value={e.hint} maxlength="300" class={input} />
						</label>
					{/if}
				</li>
			{:else}
				<li class="text-sm text-zinc-500">No queda ningún ejercicio.</li>
			{/each}
		</ol>

		<fieldset class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
			<legend class="mb-2 text-zinc-300">Al equivocarse</legend>
			<label class="flex items-center gap-2">
				Intentos
				<select
					name="tries"
					class="rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm"
					value={hw.rules.tries ?? 'sin'}
				>
					{#each data.triesOptions as t (t)}
						<option value={t ?? 'sin'}>{t ?? 'Sin límite'}</option>
					{/each}
				</select>
			</label>
			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					name="hints"
					checked={hw.rules.hints}
					class="rounded border-zinc-700 bg-zinc-900 text-amber-500"
				/>
				Darle la pista
			</label>
			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					name="showAnswer"
					checked={hw.rules.showAnswer}
					class="rounded border-zinc-700 bg-zinc-900 text-amber-500"
				/>
				Enseñarle la buena al acabar los intentos
			</label>
		</fieldset>

		<div class="flex flex-wrap items-center gap-3">
			<button class={primary} formaction="?/assign" disabled={busy !== null || !exercises.length}
				>{busy === 'assign' ? 'Dando…' : `Dárselo a ${data.kid}`}</button
			>
			<button class={secondary} formaction="?/save" disabled={busy !== null}
				>{busy === 'save' ? 'Guardando…' : 'Guardar'}</button
			>
			{#if form && 'saved' in form}
				<span class="text-sm text-amber-400">✓ Guardado</span>
			{/if}
			<button class={secondary} formaction="?/again" disabled={busy !== null}
				>{busy === 'again' ? 'Preparando otros…' : 'Volver a proponer'}</button
			>
			<span class="ml-auto"></span>
			{#if confirmDelete}
				<button class="text-sm font-semibold text-red-400" formaction="?/delete">Borrar</button>
				<button type="button" class="text-sm" onclick={() => (confirmDelete = false)}>No</button>
			{:else}
				<button
					type="button"
					class="text-sm text-zinc-400 hover:text-red-400"
					onclick={() => (confirmDelete = true)}>Borrar…</button
				>
			{/if}
		</div>
	</form>
{:else}
	<ol class="flex flex-col gap-4">
		{#each hw.exercises as e, i (i)}
			{@const step = hw.steps[i]}
			{@const right = e.kind !== 'open' && step?.done && step.answer === e.answer}
			<li class="rounded-md border border-zinc-800 p-4">
				<p class="mb-2 text-xs text-zinc-400">
					{i + 1}. {KIND[e.kind]} · {data.episodes[e.episodeId] ?? ''}
				</p>
				<p class="mb-2">{e.question}</p>
				{#if e.kind === 'open'}
					{#if step?.done}
						<p class="rounded-md bg-zinc-900 p-3 text-sm whitespace-pre-line">«{step.answer}»</p>
					{:else}
						<p class="text-sm text-zinc-500">Sin contestar todavía.</p>
					{/if}
					{#if e.expected}
						<p class="mt-2 text-xs text-zinc-400">Debería decir: {e.expected}</p>
					{/if}
				{:else}
					<ul class="flex flex-col gap-1 text-sm">
						{#each e.options as option, j (j)}
							<li
								class={[
									j === e.answer && 'text-emerald-300',
									step?.answer === j && j !== e.answer && 'text-red-300 line-through'
								]}
							>
								{j === e.answer ? '✓' : '·'}
								{option}
								{#if step?.answer === j}<span class="text-xs text-zinc-400"> ← eligió</span>{/if}
							</li>
						{/each}
					</ul>
					{#if step?.done}
						<p class={['mt-2 text-xs', right ? 'text-emerald-400' : 'text-red-400']}>
							{right
								? step.tries === 1
									? 'Bien a la primera'
									: `Bien, en ${step.tries} intentos`
								: `Mal, tras ${step.tries} ${step.tries === 1 ? 'intento' : 'intentos'}`}
						</p>
					{:else}
						<p class="mt-2 text-xs text-zinc-500">Sin contestar todavía.</p>
					{/if}
				{/if}
			</li>
		{/each}
	</ol>
	<form method="post" action="?/delete" class="mt-6" use:enhance>
		{#if confirmDelete}
			<button class="text-sm font-semibold text-red-400">Borrar estos deberes</button>
			<button type="button" class="ml-2 text-sm" onclick={() => (confirmDelete = false)}>No</button>
		{:else}
			<button
				type="button"
				class="text-sm text-zinc-400 hover:text-red-400"
				onclick={() => (confirmDelete = true)}>Borrar…</button
			>
		{/if}
	</form>
{/if}
