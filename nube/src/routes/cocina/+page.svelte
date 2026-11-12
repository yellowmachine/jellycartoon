<script lang="ts">
	import { onMount } from 'svelte';
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import { kitchenMode } from '#lib/kitchen-mode.svelte.ts';
	import { recipe } from '#lib/recipe.svelte.ts';
	import type { PageProps } from './$types';

	/**
	 * The kitchen's home (#483), its «Receta» tab, on the right of the steps: the recipe being
	 * cooked, whole and big (the ingredients, every step, a tap goes to it), and the family's
	 * recipe book, to pick another (its page opens here too, with «Cocinar»).
	 */
	let { data }: PageProps = $props();

	// Come here (a link, a reload once the mode went off): the kitchen, on.
	onMount(() => {
		kitchenMode.load();
		if (!kitchenMode.on) void kitchenMode.set(true);
	});

	const current = $derived(recipe.current);
	/** The one being cooked, if it is in the book: its picture and its page. */
	const inBook = $derived(
		current
			? data.recipes.find(
					(r) => r.title.toLocaleLowerCase('es') === current.title.toLocaleLowerCase('es')
				)
			: undefined
	);
</script>

<svelte:head>
	<title>Cocina · Seilide</title>
</svelte:head>

{#if current}
	<section class="mb-10">
		<header class="mb-6 flex items-start gap-4">
			{#if inBook?.imageUrl}
				<img
					src={inBook.imageUrl}
					alt=""
					referrerpolicy="no-referrer"
					class="h-24 w-24 shrink-0 rounded-xl bg-zinc-800 object-cover"
				/>
			{/if}
			<div class="min-w-0">
				<h1 class="text-3xl font-bold text-amber-300">{current.title}</h1>
				<p class="text-lg text-zinc-400">
					{current.servings ? `Para ${current.servings} · ` : ''}{current.steps.length} pasos{#if inBook}
						· <a href="/recetas/{inBook.id}" class="underline hover:text-white">en el recetario</a
						>{/if}
				</p>
			</div>
		</header>

		<div class="grid gap-8 lg:grid-cols-[2fr_3fr]">
			{#if current.ingredients.length}
				<div>
					<h2 class="mb-3 text-xl font-semibold">Ingredientes</h2>
					<ul class="space-y-2 text-xl text-zinc-200">
						{#each current.ingredients as ingredient, i (i)}
							<li class="border-b border-zinc-800 pb-2">{ingredient}</li>
						{/each}
					</ul>
				</div>
			{/if}
			<div>
				<h2 class="mb-3 text-xl font-semibold">Pasos</h2>
				<ol class="space-y-1">
					{#each current.steps as s, i (i)}
						<li>
							<button
								class={[
									'w-full rounded-lg px-3 py-2 text-left text-xl hover:bg-zinc-800',
									i === recipe.step
										? 'bg-amber-500/15 text-amber-300'
										: i < recipe.step
											? 'text-zinc-500'
											: 'text-zinc-200'
								]}
								aria-current={i === recipe.step ? 'step' : undefined}
								onclick={() => recipe.goAndSay(i)}
								>{i + 1}. {s.text}{#if s.timer}<span class="text-amber-400/80">
										· ⏱ {s.timer.minutes} min</span
									>{/if}</button
							>
						</li>
					{/each}
				</ol>
			</div>
		</div>
	</section>
{:else}
	<p class="mb-8 text-2xl text-zinc-300">
		Elige una receta del recetario, o pídela con la voz: «vamos a hacer lentejas».
	</p>
{/if}

<section>
	<h2 class="mb-4 text-xl font-semibold">{current ? 'Otra receta' : 'Recetario'}</h2>
	{#if !data.recipes.length}
		<p class="text-zinc-400">
			Todavía no hay ninguna. Se guardan en <a href="/recetas" class="underline">Recetas</a>.
		</p>
	{:else}
		<div class="grid grid-cols-3 gap-4 lg:grid-cols-4 xl:grid-cols-5">
			{#each data.recipes as r (r.id)}
				<a href="/recetas/{r.id}" class="group block min-w-0">
					{#if r.imageUrl}
						<img
							src={r.imageUrl}
							alt=""
							loading="lazy"
							referrerpolicy="no-referrer"
							class="mb-2 aspect-square w-full rounded-xl bg-zinc-800 object-cover group-hover:opacity-80"
						/>
					{:else}
						<span
							class="mb-2 flex aspect-square w-full items-center justify-center rounded-xl bg-zinc-800 text-zinc-600"
							><SectionIcon name="recetas" class="h-1/3 w-1/3" /></span
						>
					{/if}
					<span class="block truncate text-base group-hover:text-amber-400">{r.title}</span>
				</a>
			{/each}
		</div>
	{/if}
</section>
