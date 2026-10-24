<script lang="ts">
	import '@fontsource/comic-neue/400.css';
	import '@fontsource/comic-neue/700.css';
	import type { TryResult } from '#lib/homework.ts';
	import type { PageProps } from './$types';

	/**
	 * A child's homework (#142), one exercise at a time, on the tablet or the computer: big, in a
	 * hand's letter, with the result at once. The right one comes from the server after each try.
	 */
	let { data }: PageProps = $props();

	// The page's own copy: each answer changes it, without loading again.
	let exercises = $derived(structuredClone($state.snapshot(data.exercises)));
	/** Where the child is: the first not done, or the end. */
	let at = $state(-1);
	$effect(() => {
		if (at === -1) at = exercises.findIndex((e) => !e.step.done);
	});
	const current = $derived(at >= 0 ? exercises[at] : undefined);
	const finished = $derived(exercises.every((e) => e.step.done));

	/** After a try at the one on screen: what to say. */
	let said = $state<TryResult | null>(null);
	/** Options already tried wrong at the one on screen. */
	let wrongTries = $state<number[]>([]);
	let written = $state('');
	let sending = $state(false);
	let problem = $state(false);

	const en = $derived(data.homework.language === 'en');
	const t = $derived(
		en
			? {
					of: 'of',
					right: 'Well done!',
					again: 'Almost! Try again.',
					wrong: 'Not this time.',
					rightWas: 'The right one was:',
					next: 'Next',
					send: 'Send',
					write: 'Write your answer…',
					thanks: 'Thank you! A grown-up will read it.',
					end: 'Finished!',
					score: (r: number, c: number) => `${r} of ${c} right`,
					toRead: 'Your own answers will be read at home.',
					back: 'Back home',
					problem: 'It could not be sent. Try again.'
				}
			: {
					of: 'de',
					right: '¡Muy bien!',
					again: '¡Casi! Prueba otra vez.',
					wrong: 'Esta vez no.',
					rightWas: 'La buena era:',
					next: 'Siguiente',
					send: 'Enviar',
					write: 'Escribe tu respuesta…',
					thanks: '¡Gracias! Lo leerán en casa.',
					end: '¡Terminado!',
					score: (r: number, c: number) => `${r} de ${c} bien`,
					toRead: 'Tus respuestas escritas las leerán en casa.',
					back: 'Volver al inicio',
					problem: 'No se pudo enviar. Prueba otra vez.'
				}
	);

	async function send(answer: number | string) {
		if (sending || !current) return;
		sending = true;
		problem = false;
		const res = await fetch(`/api/deberes/${data.homework.id}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ index: at, answer })
		}).catch(() => null);
		sending = false;
		if (!res?.ok) return void (problem = true);
		const { result, steps } = (await res.json()) as {
			result: TryResult | null;
			steps: { answer: number | string | null; tries: number; done: boolean }[];
		};
		current.step = steps[at]!;
		if (!result) return void (said = null);
		said = result;
		if (result.result === 'again' && typeof answer === 'number') wrongTries.push(answer);
		if (result.result === 'right') {
			current.right = true;
			current.answer = answer as number;
		}
		if (result.result === 'wrong') {
			current.right = false;
			current.answer = result.right;
		}
	}

	function next() {
		said = null;
		wrongTries = [];
		written = '';
		at = exercises.findIndex((e) => !e.step.done);
	}

	const score = $derived({
		right: exercises.filter((e) => e.right === true).length,
		closed: exercises.filter((e) => e.kind !== 'open').length,
		written: exercises.some((e) => e.kind === 'open')
	});
</script>

<svelte:head>
	<title>{data.homework.title} · Deberes</title>
</svelte:head>

<div class="hand mx-auto flex max-w-2xl flex-col gap-6 py-4">
	<header class="flex items-baseline justify-between gap-3">
		<h1 class="text-2xl font-bold">📚 {data.homework.title}</h1>
		{#if current && !finished}
			<span class="shrink-0 text-lg text-zinc-400">{at + 1} {t.of} {exercises.length}</span>
		{/if}
	</header>

	{#if current && (!current.step.done || said)}
		<div class="h-2 overflow-hidden rounded-full bg-zinc-800">
			<div
				class="h-full bg-amber-400 transition-all"
				style:width="{(exercises.filter((e) => e.step.done).length / exercises.length) * 100}%"
			></div>
		</div>

		<p class="text-3xl leading-snug font-bold">{current.question}</p>

		{#if current.kind === 'open'}
			{#if current.step.done}
				<p class="rounded-2xl bg-zinc-900 p-4 text-2xl">«{current.step.answer}»</p>
				<p class="text-2xl text-emerald-300">{t.thanks}</p>
			{:else}
				<textarea
					bind:value={written}
					rows="4"
					maxlength="1000"
					placeholder={t.write}
					class="rounded-2xl border-zinc-700 bg-zinc-900 p-4 text-2xl"></textarea>
				<button
					class="self-end rounded-2xl bg-amber-500 px-8 py-3 text-2xl font-bold text-zinc-950 disabled:opacity-40"
					disabled={!written.trim() || sending}
					onclick={() => send(written)}>{t.send}</button
				>
			{/if}
		{:else}
			<div class="grid gap-3">
				{#each current.options as option, j (j)}
					{@const isRight = current.step.done && current.answer === j}
					{@const isWrong =
						wrongTries.includes(j) || (current.step.done && current.step.answer === j && !isRight)}
					<button
						class={[
							'rounded-2xl border-4 px-5 py-4 text-left text-2xl font-bold transition',
							isRight
								? 'border-emerald-400 bg-emerald-900/60'
								: isWrong
									? 'border-red-500/60 bg-red-950/40 text-zinc-400 line-through'
									: 'border-zinc-700 bg-zinc-900 hover:border-amber-400 active:scale-[0.98]'
						]}
						disabled={current.step.done || isWrong || sending}
						onclick={() => send(j)}>{option}</button
					>
				{/each}
			</div>
		{/if}

		{#if said}
			<div
				class={[
					'rounded-2xl p-4 text-2xl',
					said.result === 'right' && 'bg-emerald-900/50 text-emerald-200',
					said.result === 'again' && 'bg-amber-900/40 text-amber-200',
					said.result === 'wrong' && 'bg-zinc-800 text-zinc-200'
				]}
				role="status"
			>
				{#if said.result === 'right'}
					🎉 {t.right}
				{:else if said.result === 'again'}
					🤔 {t.again}
					{#if said.hint}<p class="mt-2 text-xl">💡 {said.hint}</p>{/if}
				{:else}
					{t.wrong}
					{#if said.right !== null}
						<p class="mt-2 text-xl">{t.rightWas} <b>{current.options[said.right]}</b></p>
					{/if}
				{/if}
			</div>
		{/if}

		{#if problem}
			<p class="text-xl text-red-400" role="alert">{t.problem}</p>
		{/if}

		{#if current.step.done}
			<button
				class="self-end rounded-2xl bg-amber-500 px-8 py-3 text-2xl font-bold text-zinc-950"
				onclick={next}>{t.next} →</button
			>
		{/if}
	{:else if finished}
		<div class="flex flex-col items-center gap-4 py-10 text-center">
			<p class="text-5xl">🌟</p>
			<p class="text-4xl font-bold">{t.end}</p>
			{#if score.closed}
				<p class="text-3xl text-amber-300">{t.score(score.right, score.closed)}</p>
			{/if}
			{#if score.written}
				<p class="text-xl text-zinc-300">{t.toRead}</p>
			{/if}
			<a href="/" class="mt-4 rounded-2xl bg-zinc-800 px-6 py-3 text-xl hover:bg-zinc-700"
				>{t.back}</a
			>
		</div>
	{/if}
</div>

<style>
	.hand {
		font-family: 'Comic Neue', cursive;
	}
</style>
