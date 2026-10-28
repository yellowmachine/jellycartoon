<script lang="ts">
	import { describeTimer } from 'comun/recipe.ts';
	import { recipe } from '#lib/recipe.svelte.ts';

	/**
	 * The recipe being cooked (#60), on /voz: the step the cook is on, big enough to read from
	 * across the kitchen, with buttons to go on or back (read aloud), the ingredients and every
	 * step. The AI moves it too, by voice, and the timers when they end.
	 */

	const current = $derived(recipe.current!);
	const step = $derived(current.steps[recipe.step]!);
	const last = $derived(recipe.step === current.steps.length - 1);

	const nav =
		'rounded-2xl bg-zinc-800 px-6 py-4 text-2xl font-semibold transition hover:bg-zinc-700 active:scale-95 disabled:opacity-30';
</script>

<section class="w-full max-w-2xl rounded-2xl border border-amber-500/40 bg-zinc-900 p-6 text-left">
	<header class="mb-4 flex items-start justify-between gap-4">
		<div class="min-w-0">
			<h2 class="text-2xl font-bold text-amber-300">🍳 {current.title}</h2>
			<p class="text-lg text-zinc-400">
				Paso {recipe.step + 1} de {current.steps.length}{current.servings
					? ` · para ${current.servings}`
					: ''}
			</p>
		</div>
		<button
			class="shrink-0 rounded-md px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-800 hover:text-white"
			onclick={() => recipe.end()}>Terminar</button
		>
	</header>

	<p class="text-3xl leading-snug font-semibold">{step.text}</p>
	{#if step.timer}
		<p class="mt-3 text-lg text-amber-400">⏱ {describeTimer(step.timer)}</p>
	{/if}

	<div class="mt-6 grid grid-cols-2 gap-3">
		<button
			class={nav}
			disabled={recipe.step === 0}
			onclick={() => recipe.goAndSay(recipe.step - 1)}>← Anterior</button
		>
		<button class={nav} disabled={last} onclick={() => recipe.goAndSay(recipe.step + 1)}
			>Siguiente →</button
		>
	</div>

	{#if current.ingredients.length}
		<details class="mt-6">
			<summary class="cursor-pointer text-lg text-zinc-300">Ingredientes</summary>
			<ul class="mt-2 list-disc space-y-1 pl-6 text-lg text-zinc-300">
				{#each current.ingredients as ingredient, i (i)}
					<li>{ingredient}</li>
				{/each}
			</ul>
		</details>
	{/if}
	<details class="mt-3">
		<summary class="cursor-pointer text-lg text-zinc-300">Todos los pasos</summary>
		<ol class="mt-2 space-y-1">
			{#each current.steps as s, i (i)}
				<li>
					<button
						class={[
							'w-full rounded-md px-2 py-1 text-left text-lg hover:bg-zinc-800',
							i === recipe.step
								? 'text-amber-300'
								: i < recipe.step
									? 'text-zinc-500'
									: 'text-zinc-300'
						]}
						onclick={() => recipe.goAndSay(i)}>{i + 1}. {s.text}</button
					>
				</li>
			{/each}
		</ol>
	</details>
</section>
